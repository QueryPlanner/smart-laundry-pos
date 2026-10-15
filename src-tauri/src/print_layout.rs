//! Deterministic page layout for bills and garment tags.
//!
//! This module is pure: it decides what text goes on which page, at which size and position,
//! using a caller-supplied text measurer. The operating-system adapters only draw the result.
//! Keeping layout here means overflow, wrapping, pagination and fit are tested on every
//! platform, and a layout problem is found *before* a spool job exists.
//!
//! Only the Windows adapter draws with this layout, so on other platforms most of it is compiled
//! (and unit-tested) but intentionally unused.
#![cfg_attr(not(any(target_os = "windows", test)), allow(dead_code))]

use crate::printing::{BillDocument, PrintDocument, PrintError, TagDocument, TagPiece};

const POINTS_PER_LINE_HEIGHT: f32 = 1.3;
const BILL_MARGIN_PT: f32 = 36.0;
const TAG_MARGIN_PT: f32 = 6.0;
const MIN_BILL_WIDTH_PT: f32 = 200.0;
const MIN_TAG_WIDTH_PT: f32 = 60.0;
const MAX_BILL_PAGES: usize = 50;
/// (bill number, garment/service/position, piece id) point sizes, tried largest first.
/// The piece ID is what staff match at pickup, so it never shrinks below 8 pt.
const TAG_SIZE_STEPS: [(f32, f32, f32); 5] = [
    (10.0, 12.0, 10.0),
    (9.0, 10.0, 9.0),
    (8.0, 9.0, 8.0),
    (7.0, 8.0, 8.0),
    (6.0, 7.0, 8.0),
];
/// A page wider than this (about 4.6 inches) is not a 50 mm label roll: tags would print one per
/// large sheet. The TSC driver must be set to the label size.
const MAX_TAG_WIDTH_PT: f32 = 330.0;

/// Printable area of a page in typographic points (1/72 inch).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PageSpec {
    pub width_pt: f32,
    pub height_pt: f32,
}

/// Measures rendered text width in points. The Windows adapter implements this with GDI.
pub trait TextMeter {
    fn width_pt(&self, text: &str, size_pt: f32, bold: bool) -> f32;
}

#[derive(Debug, Clone, PartialEq)]
pub struct StyledLine {
    pub text: String,
    pub size_pt: f32,
    pub bold: bool,
    /// Distance from the top of the printable area to the top of this line.
    pub y_pt: f32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LaidOutPage {
    /// Distance from the left of the printable area to every line.
    pub margin_pt: f32,
    pub lines: Vec<StyledLine>,
}

pub fn layout_document(
    document: &PrintDocument,
    spec: PageSpec,
    meter: &dyn TextMeter,
) -> Result<Vec<LaidOutPage>, PrintError> {
    match document {
        PrintDocument::Bill(bill) => layout_bill(bill, spec, meter),
        PrintDocument::Tags(tags) => layout_tags(tags, spec, meter),
    }
}

/// Greedy word wrap. A single word wider than the line is broken by characters, and every output
/// line holds at least one character, so the loop always terminates.
pub fn wrap_text(
    text: &str,
    max_width_pt: f32,
    size_pt: f32,
    bold: bool,
    meter: &dyn TextMeter,
) -> Vec<String> {
    let fits = |candidate: &str| meter.width_pt(candidate, size_pt, bold) <= max_width_pt;
    let mut lines = Vec::new();
    let mut current = String::new();
    for word in text.split_whitespace() {
        let joined = if current.is_empty() {
            word.to_owned()
        } else {
            format!("{current} {word}")
        };
        if fits(&joined) {
            current = joined;
            continue;
        }
        if !current.is_empty() {
            lines.push(std::mem::take(&mut current));
        }
        if fits(word) {
            current = word.to_owned();
            continue;
        }
        for ch in word.chars() {
            let mut grown = current.clone();
            grown.push(ch);
            if !current.is_empty() && !fits(&grown) {
                lines.push(std::mem::take(&mut current));
                current.push(ch);
            } else {
                current = grown;
            }
        }
    }
    if !current.is_empty() {
        lines.push(current);
    }
    if lines.is_empty() {
        lines.push(String::new());
    }
    lines
}

pub fn format_money(minor: i64) -> String {
    let sign = if minor < 0 { "-" } else { "" };
    let value = minor.unsigned_abs();
    format!("{sign}\u{20b9}{}.{:02}", value / 100, value % 100)
}

/// Customer or catalogue text with control characters removed and whitespace collapsed.
pub fn safe_text(value: &str) -> String {
    value
        .chars()
        .map(|ch| if ch.is_control() { ' ' } else { ch })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

struct Block {
    text: String,
    size_pt: f32,
    bold: bool,
    gap_before_pt: f32,
}

fn block(text: impl Into<String>, size_pt: f32, bold: bool, gap_before_pt: f32) -> Block {
    Block {
        text: text.into(),
        size_pt,
        bold,
        gap_before_pt,
    }
}

fn bill_blocks(bill: &BillDocument) -> Vec<Block> {
    let mut blocks = vec![
        block("SMART LAUNDRY", 18.0, true, 0.0),
        block(
            format!("Bill: {}", safe_text(&bill.order_number)),
            12.0,
            true,
            6.0,
        ),
        block(
            format!("Date: {}", safe_text(&bill.created_at_ist)),
            10.0,
            false,
            2.0,
        ),
        block(
            format!("Customer: {}", safe_text(&bill.customer_name)),
            10.0,
            false,
            2.0,
        ),
    ];
    let phone = safe_text(&bill.customer_phone);
    if !phone.is_empty() {
        blocks.push(block(format!("Phone: {phone}"), 10.0, false, 2.0));
    }
    for (index, item) in bill.items.iter().enumerate() {
        let gap = if index == 0 { 12.0 } else { 6.0 };
        blocks.push(block(
            format!(
                "{} - {}",
                safe_text(&item.garment),
                safe_text(&item.service)
            ),
            10.0,
            true,
            gap,
        ));
        blocks.push(block(
            format!(
                "{} x {} = {}",
                item.quantity,
                format_money(item.unit_price_minor),
                format_money(item.line_total_minor)
            ),
            10.0,
            false,
            1.0,
        ));
    }
    blocks.push(block(
        format!("Pieces: {}", bill.physical_piece_count),
        10.0,
        false,
        12.0,
    ));
    blocks.push(block(
        format!("Subtotal: {}", format_money(bill.subtotal_minor)),
        10.0,
        false,
        2.0,
    ));
    if bill.discount_minor > 0 {
        blocks.push(block(
            format!(
                "Discount ({}%): -{}",
                format_percent(bill.discount_percent_bp),
                format_money(bill.discount_minor)
            ),
            10.0,
            false,
            2.0,
        ));
    }
    blocks.push(block(
        format!(
            "Total: {}",
            format_money(bill.subtotal_minor - bill.discount_minor)
        ),
        12.0,
        true,
        4.0,
    ));
    blocks.push(block(
        format!("Paid: {}", format_money(bill.paid_minor)),
        10.0,
        false,
        2.0,
    ));
    if bill.balance_minor > 0 {
        blocks.push(block(
            format!("Balance due: {}", format_money(bill.balance_minor)),
            10.0,
            true,
            2.0,
        ));
    }
    blocks.push(block(
        format!("Ready by: {}", safe_text(&bill.promised_at_ist)),
        12.0,
        true,
        12.0,
    ));
    blocks.push(block("Thank you", 10.0, false, 8.0));
    blocks
}

/// Basis points as a percentage without trailing zeros: 1000 -> "10", 1250 -> "12.5", 5 -> "0.05".
pub fn format_percent(percent_bp: i64) -> String {
    let whole = percent_bp / 100;
    let fraction = percent_bp % 100;
    match fraction {
        0 => whole.to_string(),
        f if f % 10 == 0 => format!("{whole}.{}", f / 10),
        f => format!("{whole}.{f:02}"),
    }
}

fn layout_bill(
    bill: &BillDocument,
    spec: PageSpec,
    meter: &dyn TextMeter,
) -> Result<Vec<LaidOutPage>, PrintError> {
    if spec.width_pt < MIN_BILL_WIDTH_PT || spec.height_pt < 2.0 * BILL_MARGIN_PT + 40.0 {
        return Err(PrintError::Invalid(
            "the selected bill printer page is too small for a bill".into(),
        ));
    }
    let content_width = spec.width_pt - 2.0 * BILL_MARGIN_PT;
    let bottom = spec.height_pt - BILL_MARGIN_PT;
    let continuation = format!("Bill: {} (continued)", safe_text(&bill.order_number));
    let mut pages = vec![LaidOutPage {
        margin_pt: BILL_MARGIN_PT,
        lines: Vec::new(),
    }];
    let mut y = BILL_MARGIN_PT;
    for block in bill_blocks(bill) {
        let wrapped = wrap_text(&block.text, content_width, block.size_pt, block.bold, meter);
        for (index, text) in wrapped.into_iter().enumerate() {
            let line_height = block.size_pt * POINTS_PER_LINE_HEIGHT;
            let gap = if index == 0 { block.gap_before_pt } else { 0.0 };
            let page_is_empty = pages.last().is_some_and(|page| page.lines.is_empty());
            if !page_is_empty && y + gap + line_height > bottom {
                if pages.len() >= MAX_BILL_PAGES {
                    return Err(PrintError::Invalid(
                        "the bill is too long to print on one document".into(),
                    ));
                }
                pages.push(LaidOutPage {
                    margin_pt: BILL_MARGIN_PT,
                    lines: vec![StyledLine {
                        text: continuation.clone(),
                        size_pt: 10.0,
                        bold: true,
                        y_pt: BILL_MARGIN_PT,
                    }],
                });
                y = BILL_MARGIN_PT + 10.0 * POINTS_PER_LINE_HEIGHT + 6.0;
                pages
                    .last_mut()
                    .expect("a page was just pushed")
                    .lines
                    .push(StyledLine {
                        text,
                        size_pt: block.size_pt,
                        bold: block.bold,
                        y_pt: y,
                    });
                y += line_height;
                continue;
            }
            let top = if page_is_empty { y } else { y + gap };
            pages
                .last_mut()
                .expect("a page always exists")
                .lines
                .push(StyledLine {
                    text,
                    size_pt: block.size_pt,
                    bold: block.bold,
                    y_pt: top,
                });
            y = top + line_height;
        }
    }
    Ok(pages)
}

fn layout_tags(
    tags: &TagDocument,
    spec: PageSpec,
    meter: &dyn TextMeter,
) -> Result<Vec<LaidOutPage>, PrintError> {
    if spec.width_pt < MIN_TAG_WIDTH_PT || spec.height_pt < 2.0 * TAG_MARGIN_PT + 20.0 {
        return Err(PrintError::Invalid(
            "the selected tag printer label size is too small for a garment tag".into(),
        ));
    }
    if spec.width_pt > MAX_TAG_WIDTH_PT {
        return Err(PrintError::Invalid(
            "the tag printer is not set to a label size (the page is far wider than a 50 mm label); check its driver paper size"
                .into(),
        ));
    }
    tags.pieces
        .iter()
        .map(|piece| layout_one_tag(&tags.order_number, piece, spec, meter))
        .collect()
}

fn layout_one_tag(
    order_number: &str,
    piece: &TagPiece,
    spec: PageSpec,
    meter: &dyn TextMeter,
) -> Result<LaidOutPage, PrintError> {
    let content_width = spec.width_pt - 2.0 * TAG_MARGIN_PT;
    let available_height = spec.height_pt - 2.0 * TAG_MARGIN_PT;
    for (small, large, id_size) in TAG_SIZE_STEPS {
        let blocks = [
            (format!("Bill {}", safe_text(order_number)), small, true),
            (safe_text(&piece.garment), large, true),
            (safe_text(&piece.service), large, false),
            (
                format!("Piece {}/{}", piece.position, piece.total),
                large,
                true,
            ),
            (format!("ID {}", safe_text(&piece.piece_id)), id_size, false),
        ];
        let mut lines = Vec::new();
        let mut y = TAG_MARGIN_PT;
        for (text, size, bold) in blocks {
            for wrapped in wrap_text(&text, content_width, size, bold, meter) {
                lines.push(StyledLine {
                    text: wrapped,
                    size_pt: size,
                    bold,
                    y_pt: y,
                });
                y += size * POINTS_PER_LINE_HEIGHT;
            }
        }
        if y - TAG_MARGIN_PT <= available_height {
            return Ok(LaidOutPage {
                margin_pt: TAG_MARGIN_PT,
                lines,
            });
        }
    }
    Err(PrintError::Invalid(format!(
        "the text for tag {}/{} does not fit on the label",
        piece.position, piece.total
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::printing::BillItem;

    /// Every character is `0.55 * size` wide (`0.6` when bold): a coarse stand-in for real fonts.
    struct FakeMeter;
    impl TextMeter for FakeMeter {
        fn width_pt(&self, text: &str, size_pt: f32, bold: bool) -> f32 {
            text.chars().count() as f32 * size_pt * if bold { 0.6 } else { 0.55 }
        }
    }

    const A4: PageSpec = PageSpec {
        width_pt: 595.0,
        height_pt: 842.0,
    };
    const TAG: PageSpec = PageSpec {
        width_pt: 141.0,
        height_pt: 141.0,
    };

    fn bill(items: usize) -> BillDocument {
        BillDocument {
            order_number: "LA-2026-00123".into(),
            created_at_ist: "15 Oct 2026 10:30 AM".into(),
            promised_at_ist: "17 Oct 2026 05:00 PM".into(),
            customer_name: "Asha Patil".into(),
            customer_phone: "9876543210".into(),
            items: (0..items)
                .map(|n| BillItem {
                    garment: format!("Garment {n}"),
                    service: "Wash + Iron".into(),
                    quantity: 2,
                    unit_price_minor: 2500,
                    line_total_minor: 5000,
                })
                .collect(),
            subtotal_minor: 5000 * items as i64,
            discount_percent_bp: 0,
            discount_minor: 0,
            paid_minor: 5000 * items as i64,
            balance_minor: 0,
            physical_piece_count: 2 * items as u32,
        }
    }

    fn tag(garment: &str, service: &str) -> TagDocument {
        TagDocument {
            order_number: "LA-2026-00123".into(),
            pieces: vec![TagPiece {
                piece_id: "2600123-3".into(),
                garment: garment.into(),
                service: service.into(),
                position: 3,
                total: 4,
            }],
        }
    }

    fn texts(page: &LaidOutPage) -> Vec<&str> {
        page.lines.iter().map(|l| l.text.as_str()).collect()
    }

    fn assert_within(page: &LaidOutPage, spec: PageSpec) {
        for line in &page.lines {
            assert!(
                FakeMeter.width_pt(&line.text, line.size_pt, line.bold)
                    <= spec.width_pt - 2.0 * page.margin_pt + 0.01,
                "line too wide: {}",
                line.text
            );
            assert!(
                line.y_pt + line.size_pt <= spec.height_pt,
                "line below page: {}",
                line.text
            );
        }
    }

    #[test]
    fn one_item_bill_fits_a_single_a4_page_at_readable_sizes() {
        let pages = layout_bill(&bill(1), A4, &FakeMeter).unwrap();
        assert_eq!(pages.len(), 1);
        assert_within(&pages[0], A4);
        assert!(pages[0].lines.iter().all(|l| l.size_pt <= 18.0));
        let lines = texts(&pages[0]);
        assert!(lines.contains(&"Total: \u{20b9}50.00"));
        assert!(lines.contains(&"Ready by: 17 Oct 2026 05:00 PM"));
        assert!(!lines.iter().any(|l| l.starts_with("Balance")));
        assert!(!lines.iter().any(|l| l.starts_with("Discount")));
    }

    #[test]
    fn long_bills_paginate_without_losing_or_overflowing_lines() {
        let pages = layout_bill(&bill(40), A4, &FakeMeter).unwrap();
        assert!(pages.len() > 1);
        for page in &pages {
            assert_within(page, A4);
        }
        assert!(pages[1].lines[0].text.ends_with("(continued)"));
        let garments = pages
            .iter()
            .flat_map(|p| p.lines.iter())
            .filter(|l| l.text.starts_with("Garment "))
            .count();
        assert_eq!(garments, 40);
        assert!(texts(pages.last().unwrap()).contains(&"Thank you"));
    }

    #[test]
    fn bill_shows_discount_and_balance_when_present() {
        let mut document = bill(1);
        document.discount_percent_bp = 1250;
        document.discount_minor = 625;
        document.paid_minor = 4000;
        document.balance_minor = 375;
        let pages = layout_bill(&document, A4, &FakeMeter).unwrap();
        let lines = texts(&pages[0]);
        assert!(lines.contains(&"Discount (12.5%): -\u{20b9}6.25"));
        assert!(lines.contains(&"Total: \u{20b9}43.75"));
        assert!(lines.contains(&"Balance due: \u{20b9}3.75"));
    }

    #[test]
    fn very_long_customer_names_wrap_instead_of_overflowing() {
        let mut document = bill(1);
        document.customer_name = "Ramchandra ".repeat(30) + &"X".repeat(200);
        let pages = layout_bill(&document, A4, &FakeMeter).unwrap();
        for page in &pages {
            assert_within(page, A4);
        }
    }

    #[test]
    fn a_page_that_cannot_hold_a_bill_is_rejected_before_printing() {
        let narrow = PageSpec {
            width_pt: 150.0,
            height_pt: 842.0,
        };
        assert!(matches!(
            layout_bill(&bill(1), narrow, &FakeMeter),
            Err(PrintError::Invalid(_))
        ));
        let short = PageSpec {
            width_pt: 595.0,
            height_pt: 100.0,
        };
        assert!(matches!(
            layout_bill(&bill(1), short, &FakeMeter),
            Err(PrintError::Invalid(_))
        ));
    }

    #[test]
    fn bill_page_count_is_capped() {
        assert!(matches!(
            layout_bill(&bill(2_000), A4, &FakeMeter),
            Err(PrintError::Invalid(_))
        ));
    }

    #[test]
    fn tag_carries_only_bill_garment_service_position_and_id() {
        let pages = layout_tags(&tag("Saree", "Dry Clean"), TAG, &FakeMeter).unwrap();
        assert_eq!(pages.len(), 1);
        assert_eq!(
            texts(&pages[0]),
            vec![
                "Bill LA-2026-00123",
                "Saree",
                "Dry Clean",
                "Piece 3/4",
                "ID 2600123-3"
            ]
        );
        assert_within(&pages[0], TAG);
    }

    #[test]
    fn tags_make_one_page_per_piece_and_keep_original_positions() {
        let mut document = tag("Shirt", "Wash");
        document.pieces.push(TagPiece {
            piece_id: "2600123-4".into(),
            garment: "Shirt".into(),
            service: "Wash".into(),
            position: 4,
            total: 4,
        });
        let pages = layout_tags(&document, TAG, &FakeMeter).unwrap();
        assert_eq!(pages.len(), 2);
        assert!(texts(&pages[0]).contains(&"Piece 3/4"));
        assert!(texts(&pages[1]).contains(&"Piece 4/4"));
    }

    #[test]
    fn long_tag_text_wraps_or_shrinks_to_fit_a_short_label() {
        let short_label = PageSpec {
            width_pt: 141.0,
            height_pt: 100.0,
        };
        let pages = layout_tags(
            &tag("Kurta / Kameez with embroidery", "Wash + Iron"),
            short_label,
            &FakeMeter,
        )
        .unwrap();
        assert_within(&pages[0], short_label);
        assert!(pages[0].lines.iter().any(|l| l.size_pt < 12.0));
    }

    #[test]
    fn unfittable_tag_text_fails_cleanly_and_tiny_labels_are_rejected() {
        let hopeless = tag(&"W".repeat(400), "Wash");
        assert!(matches!(
            layout_tags(&hopeless, TAG, &FakeMeter),
            Err(PrintError::Invalid(message)) if message.contains("3/4")
        ));
        let tiny = PageSpec {
            width_pt: 40.0,
            height_pt: 141.0,
        };
        assert!(matches!(
            layout_tags(&tag("Shirt", "Wash"), tiny, &FakeMeter),
            Err(PrintError::Invalid(_))
        ));
        let flat = PageSpec {
            width_pt: 141.0,
            height_pt: 20.0,
        };
        assert!(matches!(
            layout_tags(&tag("Shirt", "Wash"), flat, &FakeMeter),
            Err(PrintError::Invalid(_))
        ));
    }

    #[test]
    fn tags_are_refused_on_a_sheet_sized_page_instead_of_wasting_paper() {
        assert!(matches!(
            layout_tags(&tag("Shirt", "Wash"), A4, &FakeMeter),
            Err(PrintError::Invalid(message)) if message.contains("label size")
        ));
        let four_by_six = PageSpec {
            width_pt: 288.0,
            height_pt: 432.0,
        };
        assert!(layout_tags(&tag("Shirt", "Wash"), four_by_six, &FakeMeter).is_ok());
    }

    #[test]
    fn the_piece_id_never_shrinks_below_eight_points() {
        let short_label = PageSpec {
            width_pt: 141.0,
            height_pt: 100.0,
        };
        let pages = layout_tags(
            &tag("Kurta / Kameez with embroidery", "Wash + Iron"),
            short_label,
            &FakeMeter,
        )
        .unwrap();
        let id_line = pages[0]
            .lines
            .iter()
            .find(|l| l.text.starts_with("ID "))
            .unwrap();
        assert!(id_line.size_pt >= 8.0, "{}", id_line.size_pt);
    }

    #[test]
    fn layout_document_routes_by_document_kind() {
        let bill_pages = layout_document(&PrintDocument::Bill(bill(1)), A4, &FakeMeter).unwrap();
        assert!(texts(&bill_pages[0]).contains(&"SMART LAUNDRY"));
        let tag_pages =
            layout_document(&PrintDocument::Tags(tag("Shirt", "Wash")), TAG, &FakeMeter).unwrap();
        assert!(texts(&tag_pages[0]).contains(&"Shirt"));
    }

    #[test]
    fn wrapping_handles_words_wider_than_the_line_and_empty_text() {
        let lines = wrap_text(&"A".repeat(50), 40.0, 10.0, false, &FakeMeter);
        assert!(lines.len() > 1);
        assert!(lines.iter().all(|l| !l.is_empty()));
        assert_eq!(lines.concat(), "A".repeat(50));
        assert_eq!(wrap_text("   ", 40.0, 10.0, false, &FakeMeter), vec![""]);
        assert_eq!(
            wrap_text("one two three", 1000.0, 10.0, false, &FakeMeter),
            vec!["one two three"]
        );
        let narrow = wrap_text("ab cd", 12.0, 10.0, false, &FakeMeter);
        assert_eq!(narrow, vec!["ab", "cd"]);
    }

    #[test]
    fn text_is_cleaned_and_amounts_and_percentages_format_exactly() {
        assert_eq!(safe_text("  A\u{0}\n\tB   C "), "A B C");
        assert_eq!(format_money(5), "\u{20b9}0.05");
        assert_eq!(format_money(123_456), "\u{20b9}1234.56");
        assert_eq!(format_money(-250), "-\u{20b9}2.50");
        assert_eq!(format_percent(1000), "10");
        assert_eq!(format_percent(1250), "12.5");
        assert_eq!(format_percent(5), "0.05");
        assert_eq!(format_percent(0), "0");
        assert_eq!(format_percent(10_000), "100");
    }

    #[test]
    fn bill_without_phone_omits_the_phone_line() {
        let mut document = bill(1);
        document.customer_phone = "  ".into();
        let pages = layout_bill(&document, A4, &FakeMeter).unwrap();
        assert!(!texts(&pages[0]).iter().any(|l| l.starts_with("Phone")));
    }
}
