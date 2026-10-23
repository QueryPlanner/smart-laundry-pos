//! Deterministic page layout for bills and garment tags.
//!
//! This module is pure: it decides what text goes on which page, at which size and position,
//! using a caller-supplied text measurer. The operating-system adapters only draw the result.
//! Keeping layout here means overflow, wrapping, pagination and fit are tested on every
//! platform, and a layout problem is found *before* a spool job exists.
//!
//! The Windows GDI and Linux Cairo adapters draw with this shared layout. Tests also use a small
//! stand-in text measurer so wrapping and bounds are deterministic across platforms.
#![cfg_attr(not(any(target_os = "windows", test)), allow(dead_code))]

use crate::printing::{BillDocument, BillHeader, PrintDocument, PrintError, TagDocument, TagPiece};

/// Title used when the saved bill carries no shop name (bills saved before shop settings).
const DEFAULT_BILL_TITLE: &str = "SMART LAUNDRY";
/// Closing line used when the shop has not set a receipt footer.
const DEFAULT_BILL_FOOTER: &str = "Thank you";

const POINTS_PER_LINE_HEIGHT: f32 = 1.3;
const BILL_MARGIN_PT: f32 = 24.0;
/// The physical strip test confirmed that text starts 10 mm from the roll's left edge.
const TAG_LEFT_INSET_PT: f32 = 28.3465;
/// Keep about 3 mm clear of the roll's right edge.
const TAG_RIGHT_INSET_PT: f32 = 8.5039;
/// The vertical text inset within each configured tag pitch.
const TAG_TOP_INSET_PT: f32 = 14.1732;
/// Add one 10 mm trailing feed to the batch. The TSC delivers Piece 1 last, so that tag is placed
/// first in PDF order and this blank feed is added before its content in page coordinates.
pub(crate) const TAG_FINAL_TAIL_TENTHS_MM: u16 = 100;
const MIN_BILL_WIDTH_PT: f32 = 300.0;
const MIN_TAG_WIDTH_PT: f32 = 60.0;
const MAX_BILL_PAGES: usize = 50;
/// Font sizes tried for the item rows, largest first. A bill takes the biggest size at which every
/// row, the totals and the footer fit on one page; only if even the smallest does not fit does the
/// bill continue on another page.
const BILL_ROW_SIZE_STEPS: [f32; 5] = [10.0, 9.0, 8.0, 7.5, 7.0];
/// (bill number, garment/service/position, piece id) point sizes, tried largest first.
/// Starting type is smaller than the previous layout; piece IDs remain at least 8 pt.
const TAG_SIZE_STEPS: [(f32, f32, f32); 4] = [
    (8.0, 9.0, 8.0),
    (7.5, 8.5, 8.0),
    (7.0, 8.0, 8.0),
    (6.5, 7.5, 8.0),
];
/// A page wider than this (about 4.6 inches) is not a 50 mm label roll: tags would print one per
/// large sheet. The TSC driver must be set to the label size.
const MAX_TAG_WIDTH_PT: f32 = 330.0;
/// Longest customer name printed on a tag, counting the ellipsis that marks a cut name.
const TAG_CUSTOMER_NAME_MAX_CHARS: usize = 24;
/// Longest customer phone printed on a tag. A longer value is cut to this many characters.
const TAG_CUSTOMER_PHONE_MAX_CHARS: usize = 15;
/// Branding lines a tag strip may print. When nothing fits, they are dropped in this order: the
/// tag line first, then the shop name. The customer name and phone, bill, garment, service,
/// piece and ID are never dropped.
const TAG_BRANDING_ATTEMPTS: [TagBranding; 3] = [
    TagBranding {
        shop_name: true,
        tag_line: true,
    },
    TagBranding {
        shop_name: true,
        tag_line: false,
    },
    TagBranding {
        shop_name: false,
        tag_line: false,
    },
];

/// Physical media dimensions in typographic points (1/72 inch). Platform adapters check their
/// printable rectangle separately and translate these media-relative coordinates when needed.
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
    /// Distance from the physical page's left edge to this line.
    pub x_pt: f32,
    /// Distance from the physical page's top edge to the top of this line.
    pub y_pt: f32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StyledRule {
    pub x1_pt: f32,
    pub x2_pt: f32,
    pub y_pt: f32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LaidOutPage {
    /// Safe inset from the physical page's left edge used by the layout.
    pub margin_pt: f32,
    /// Distance from the right edge to the maximum allowed text extent.
    pub right_margin_pt: f32,
    /// Blank area reserved at the bottom of a bill page.
    pub bottom_reserved_pt: f32,
    pub rules: Vec<StyledRule>,
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

/// Height of the single continuous TSC strip: one configured pitch per selected piece, followed
/// by the single physical trailing feed. The printer's DEVMODE length is a signed 16-bit value in
/// tenths of a millimetre, so refuse an unrepresentable strip before opening a spool job.
pub(crate) fn tag_strip_length_tenths_mm(tags: &TagDocument) -> Result<u16, PrintError> {
    let total = u32::try_from(tags.pieces.len())
        .ok()
        .and_then(|count| count.checked_mul(u32::from(tags.tag_length_tenths_mm)))
        .and_then(|length| length.checked_add(u32::from(TAG_FINAL_TAIL_TENTHS_MM)))
        .ok_or_else(|| PrintError::Invalid("tag strip length overflowed".into()))?;
    u16::try_from(total)
        .ok()
        .filter(|length| *length <= i16::MAX as u16)
        .ok_or_else(|| {
            PrintError::Invalid(
                "the selected tags exceed the printer's maximum continuous strip length".into(),
            )
        })
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

/// The bill title: the shop name, or the built-in title when none was saved.
pub fn bill_title(header: &BillHeader) -> String {
    if !header.show_shop_name {
        return String::new();
    }
    let name = safe_text(&header.shop_name);
    if name.is_empty() {
        DEFAULT_BILL_TITLE.into()
    } else {
        name
    }
}

/// Lines under the title: the address, then the phone. Empty fields are left out entirely.
pub fn bill_header_lines(header: &BillHeader) -> Vec<String> {
    let mut lines = Vec::new();
    let address = safe_text(&header.address);
    if header.show_shop_address && !address.is_empty() {
        lines.push(address);
    }
    let phone = safe_text(&header.phone);
    if header.show_shop_phone && !phone.is_empty() {
        lines.push(format!("Tel: {phone}"));
    }
    lines
}

/// Optional message line centered directly below the shop identity.
pub fn bill_message(header: &BillHeader) -> String {
    safe_text(&header.message)
}

/// The closing line: the shop's receipt footer, or a plain thank-you when none was saved.
#[cfg(test)]
pub fn bill_footer(header: &BillHeader) -> String {
    let footer = safe_text(&header.footer);
    if footer.is_empty() {
        DEFAULT_BILL_FOOTER.into()
    } else {
        footer
    }
}

/// Terms and conditions printed at the bottom of every bill, in Marathi, below the footer. The
/// shop cannot turn them off, and they are added at print time, so bills saved before they existed
/// also get them.
pub const BILL_TERMS: [&str; 5] = [
    "अटी व शर्ती :",
    "1. रंग जाणे, अकुंचन होणे किंवा नाजूक कपड्यांचे नुकसान यासाठी आम्ही जबाबदार नाही.",
    "2. कोणतीही तक्रार कपडे घेतल्यानंतर लगेचच करावी.",
    "3. 30 दिवसानंतर न घेतलेल्या कपड्यांची जबाबदारी आमची राहणार नाही.",
    "4. नियम व अटी लागू.",
];

/// Terms are printed smaller than the footer (9 pt), beside the totals, so they fit on A5.
const TERMS_SIZE_PT: f32 = 7.0;
/// Distance between terms lines. Devanagari needs more than the font size for its marks.
const TERMS_PITCH_PT: f32 = 9.5;

/// Everything that closes a bill as text: the footer lines, then the fixed terms last.
pub fn bill_closing_lines(header: &BillHeader) -> Vec<String> {
    let mut lines = bill_footer_lines(header);
    lines.extend(BILL_TERMS.iter().map(|line| (*line).to_string()));
    lines
}

pub fn bill_footer_lines(header: &BillHeader) -> Vec<String> {
    let lines: Vec<_> = header
        .footer
        .lines()
        .map(safe_text)
        .filter(|line| !line.is_empty())
        .collect();
    if lines.is_empty() {
        vec![DEFAULT_BILL_FOOTER.into()]
    } else {
        lines
    }
}

/// Label for the amount collected so far. While a balance remains, more is still to come.
pub fn paid_label(balance_minor: i64) -> &'static str {
    if balance_minor > 0 {
        "Paid so far"
    } else {
        "Paid"
    }
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

fn add_line(
    page: &mut LaidOutPage,
    text: impl Into<String>,
    size_pt: f32,
    bold: bool,
    x_pt: f32,
    y_pt: f32,
) {
    page.lines.push(StyledLine {
        text: text.into(),
        size_pt,
        bold,
        x_pt,
        y_pt,
    });
}

fn right_x(text: &str, edge_pt: f32, size_pt: f32, bold: bool, meter: &dyn TextMeter) -> f32 {
    (edge_pt - meter.width_pt(text, size_pt, bold)).max(BILL_MARGIN_PT)
}

fn center_x(
    text: &str,
    left: f32,
    right: f32,
    size_pt: f32,
    bold: bool,
    meter: &dyn TextMeter,
) -> f32 {
    let width = meter.width_pt(text, size_pt, bold);
    (left + (right - left - width) / 2.0).max(left)
}

fn add_rule(page: &mut LaidOutPage, left: f32, right: f32, y: f32) {
    page.rules.push(StyledRule {
        x1_pt: left,
        x2_pt: right,
        y_pt: y,
    });
}

fn bill_page() -> LaidOutPage {
    LaidOutPage {
        margin_pt: BILL_MARGIN_PT,
        right_margin_pt: BILL_MARGIN_PT,
        bottom_reserved_pt: BILL_MARGIN_PT,
        rules: Vec::new(),
        lines: Vec::new(),
    }
}

fn table_columns(left: f32, right: f32) -> (f32, f32, f32, f32) {
    let width = right - left;
    (
        left + width * 0.27,
        left + width * 0.64,
        left + width * 0.82,
        right,
    )
}

fn add_table_heading(page: &mut LaidOutPage, y: f32, left: f32, right: f32, meter: &dyn TextMeter) {
    let (service_x, qty_edge, rate_edge, amount_edge) = table_columns(left, right);
    add_rule(page, left, right, y - 6.0);
    add_line(page, "Particulars", 9.0, true, left, y);
    add_line(page, "Service", 9.0, true, service_x, y);
    for (label, edge) in [
        ("Qty", qty_edge),
        ("Rate", rate_edge),
        ("Amount", amount_edge),
    ] {
        add_line(
            page,
            label,
            9.0,
            true,
            right_x(label, edge, 9.0, true, meter),
            y,
        );
    }
    add_rule(page, left, right, y + 13.0);
}

fn add_continuation_header(
    page: &mut LaidOutPage,
    bill: &BillDocument,
    left: f32,
    right: f32,
    meter: &dyn TextMeter,
) -> f32 {
    let title = format!("Bill: {} (continued)", safe_text(&bill.order_number));
    add_line(page, title.clone(), 11.0, true, BILL_MARGIN_PT, left);
    let y = BILL_MARGIN_PT + 28.0;
    add_table_heading(page, y, left, right, meter);
    y + 16.0
}

fn layout_bill(
    bill: &BillDocument,
    spec: PageSpec,
    meter: &dyn TextMeter,
) -> Result<Vec<LaidOutPage>, PrintError> {
    if spec.width_pt < MIN_BILL_WIDTH_PT
        || spec.height_pt < 2.0 * BILL_MARGIN_PT + 40.0
        || spec.width_pt <= spec.height_pt
    {
        return Err(PrintError::Invalid(
            "the bill printer must report a usable A5 landscape page".into(),
        ));
    }
    let left = BILL_MARGIN_PT;
    let right = spec.width_pt - BILL_MARGIN_PT;
    let width = right - left;
    let bottom = spec.height_pt - BILL_MARGIN_PT;
    let mut pages = vec![bill_page()];
    let page = pages.last_mut().unwrap();

    let mut header_y = BILL_MARGIN_PT;
    let title = bill_title(&bill.header);
    if !title.is_empty() {
        for line in wrap_text(&title, width, 18.0, true, meter) {
            add_line(
                page,
                line.clone(),
                18.0,
                true,
                center_x(&line, left, right, 18.0, true, meter),
                header_y,
            );
            header_y += 22.0;
        }
    }
    for text in bill_header_lines(&bill.header) {
        for line in wrap_text(&text, width, 10.0, false, meter) {
            add_line(
                page,
                line.clone(),
                10.0,
                false,
                center_x(&line, left, right, 10.0, false, meter),
                header_y,
            );
            header_y += 13.0;
        }
    }
    let message = bill_message(&bill.header);
    if !message.is_empty() {
        for line in wrap_text(&message, width, 10.0, false, meter) {
            add_line(
                page,
                line.clone(),
                10.0,
                false,
                center_x(&line, left, right, 10.0, false, meter),
                header_y,
            );
            header_y += 13.0;
        }
    }
    add_rule(page, left, right, header_y + 6.0);
    let mut y = header_y + 17.0;

    let bill_no = format!("Bill: {}", safe_text(&bill.order_number));
    let order_lines = wrap_text(&bill_no, width * 0.58, 22.0, true, meter);
    for (index, line) in order_lines.iter().enumerate() {
        add_line(
            page,
            line.clone(),
            22.0,
            true,
            left,
            y + index as f32 * 25.0,
        );
    }
    if bill.header.show_received_at {
        let received = format!("Received: {}", safe_text(&bill.created_at_ist));
        add_line(
            page,
            received.clone(),
            10.0,
            false,
            right_x(&received, right, 10.0, false, meter),
            y + 4.0,
        );
    }
    y += (order_lines.len() as f32 * 25.0).max(28.0);
    let customer = format!("Customer: {}", safe_text(&bill.customer_name));
    let customer_lines = wrap_text(&customer, width * 0.58, 12.0, true, meter);
    for (index, line) in customer_lines.iter().enumerate() {
        add_line(
            page,
            line.clone(),
            12.0,
            true,
            left,
            y + index as f32 * 15.0,
        );
    }
    let right_detail_y = y;
    if bill.header.show_ready_by {
        let ready = format!("Ready by: {}", safe_text(&bill.promised_at_ist));
        add_line(
            page,
            ready.clone(),
            11.0,
            true,
            right_x(&ready, right, 11.0, true, meter),
            right_detail_y,
        );
    }
    y += (customer_lines.len() as f32 * 15.0).max(16.0);
    let phone = safe_text(&bill.customer_phone);
    if bill.header.show_customer_phone && !phone.is_empty() {
        add_line(page, format!("Phone: {phone}"), 10.0, false, left, y);
        y += 13.0;
    }
    add_rule(page, left, right, y + 5.0);
    y += 14.0;

    let due = bill.subtotal_minor - bill.discount_minor;
    let payment_cells = [
        (
            format!("Due this order: {}", format_money(due)),
            left + width / 3.0,
        ),
        (
            format!(
                "{}: {}",
                paid_label(bill.balance_minor),
                format_money(bill.paid_minor)
            ),
            left + 2.0 * width / 3.0,
        ),
        (
            format!("Balance due: {}", format_money(bill.balance_minor)),
            right,
        ),
    ];
    for (label, edge) in payment_cells {
        add_line(
            page,
            label.clone(),
            10.0,
            true,
            right_x(&label, edge, 10.0, true, meter),
            y,
        );
    }
    y += 18.0;
    add_line(
        page,
        format!("Total pieces: {}", bill.physical_piece_count),
        10.0,
        true,
        left,
        y,
    );
    y += 17.0;
    add_table_heading(page, y, left, right, meter);
    y += 18.0;
    let (service_x, qty_edge, rate_edge, amount_edge) = table_columns(left, right);
    let garment_width = service_x - left - 10.0;
    let service_width = qty_edge - service_x - 10.0;
    let mut totals = vec![(
        "Subtotal".to_string(),
        format_money(bill.subtotal_minor),
        false,
    )];
    if bill.discount_minor > 0 {
        // A discount that is not a plain percentage (one given by hand) carries no percentage.
        let label = if bill.discount_percent_bp > 0 {
            format!("Discount ({}%)", format_percent(bill.discount_percent_bp))
        } else {
            "Discount".to_string()
        };
        totals.push((
            label,
            format!("-{}", format_money(bill.discount_minor)),
            false,
        ));
    }
    totals.push(("Total".into(), format_money(due), true));
    totals.push((
        paid_label(bill.balance_minor).into(),
        format_money(bill.paid_minor),
        false,
    ));
    if bill.balance_minor > 0 {
        totals.push(("Balance due".into(), format_money(bill.balance_minor), true));
    }
    // The closing lines (footer, then the terms) are part of `needed`, so the rows shrink
    // or paginate to leave room for them.
    let footer: Vec<String> = bill_footer_lines(&bill.header)
        .into_iter()
        .flat_map(|line| wrap_text(&line, width, 9.0, false, meter))
        .collect();
    // The fixed terms sit in the empty space to the left of the totals, small and tightly spaced,
    // so they add little or no height and a bill still fits one A5 page.
    let totals_left = totals
        .iter()
        .map(|(label, value, bold)| {
            let size = if *bold { 12.0 } else { 10.0 };
            right_x(&format!("{label}: {value}"), right, size, *bold, meter)
        })
        .fold(right, f32::min);
    let terms_width = (totals_left - left - 14.0).max(120.0);
    let terms: Vec<String> = BILL_TERMS
        .iter()
        .flat_map(|line| wrap_text(line, terms_width, TERMS_SIZE_PT, false, meter))
        .collect();
    let totals_height = (totals.len() as f32 * 15.0).max(terms.len() as f32 * TERMS_PITCH_PT);
    let needed = totals_height + footer.len() as f32 * 12.0 + 32.0;

    // Every item row wrapped at one size; row height and the gap after it scale with the size.
    let wrap_rows = |size: f32| -> Vec<(Vec<String>, Vec<String>)> {
        bill.items
            .iter()
            .map(|item| {
                (
                    wrap_text(&safe_text(&item.garment), garment_width, size, true, meter),
                    wrap_text(&safe_text(&item.service), service_width, size, false, meter),
                )
            })
            .collect()
    };
    let row_height = |size: f32, lines: usize| lines as f32 * size * 1.4;
    let row_gap = |size: f32| size * 0.5;
    // The largest size at which the whole bill fits on this page; the smallest if none does.
    let mut row_size = BILL_ROW_SIZE_STEPS[BILL_ROW_SIZE_STEPS.len() - 1];
    for size in BILL_ROW_SIZE_STEPS {
        let rows_height: f32 = wrap_rows(size)
            .iter()
            .map(|(garment, service)| {
                row_height(size, garment.len().max(service.len())) + row_gap(size)
            })
            .sum();
        if y + rows_height + needed <= bottom {
            row_size = size;
            break;
        }
    }
    let line_pitch = row_size * 1.4;
    for (item, (garment, service)) in bill.items.iter().zip(wrap_rows(row_size)) {
        let row_lines = garment.len().max(service.len());
        let height = row_height(row_size, row_lines);
        if y + height > bottom - needed {
            if pages.len() >= MAX_BILL_PAGES {
                return Err(PrintError::Invalid(
                    "the bill is too long to print on one document".into(),
                ));
            }
            pages.push(bill_page());
            y = add_continuation_header(pages.last_mut().unwrap(), bill, left, right, meter);
        }
        let row_page = pages.last_mut().unwrap();
        for index in 0..row_lines {
            if let Some(text) = garment.get(index) {
                add_line(
                    row_page,
                    text.clone(),
                    row_size,
                    true,
                    left,
                    y + index as f32 * line_pitch,
                );
            }
            if let Some(text) = service.get(index) {
                add_line(
                    row_page,
                    text.clone(),
                    row_size,
                    false,
                    service_x,
                    y + index as f32 * line_pitch,
                );
            }
        }
        for (text, edge) in [
            (item.quantity.to_string(), qty_edge),
            (format_money(item.unit_price_minor), rate_edge),
            (format_money(item.line_total_minor), amount_edge),
        ] {
            add_line(
                row_page,
                text.clone(),
                row_size,
                false,
                right_x(&text, edge, row_size, false, meter),
                y,
            );
        }
        y += height + row_gap(row_size);
    }

    if y + needed > bottom {
        if pages.len() >= MAX_BILL_PAGES {
            return Err(PrintError::Invalid(
                "the bill is too long to print on one document".into(),
            ));
        }
        pages.push(bill_page());
        y = add_continuation_header(pages.last_mut().unwrap(), bill, left, right, meter);
        add_line(
            pages.last_mut().unwrap(),
            format!("Total pieces: {}", bill.physical_piece_count),
            10.0,
            true,
            left,
            y,
        );
        y += 17.0;
    }
    let last_page = pages.last_mut().unwrap();
    add_rule(last_page, left, right, y - 5.0);
    for (index, line) in terms.iter().enumerate() {
        add_line(
            last_page,
            line.clone(),
            TERMS_SIZE_PT,
            false,
            left,
            y + index as f32 * TERMS_PITCH_PT,
        );
    }
    for (index, (label, value, bold)) in totals.iter().enumerate() {
        let line = format!("{label}: {value}");
        let size = if *bold { 12.0 } else { 10.0 };
        add_line(
            last_page,
            line.clone(),
            size,
            *bold,
            right_x(&line, right, size, *bold, meter),
            y + index as f32 * 15.0,
        );
    }
    let footer_y = y + totals_height + 12.0;
    add_rule(last_page, left, right, footer_y - 5.0);
    for (index, line) in footer.into_iter().enumerate() {
        add_line(
            last_page,
            line,
            9.0,
            false,
            left,
            footer_y + index as f32 * 12.0,
        );
    }
    Ok(pages)
}

fn layout_tags(
    tags: &TagDocument,
    spec: PageSpec,
    meter: &dyn TextMeter,
) -> Result<Vec<LaidOutPage>, PrintError> {
    if spec.width_pt < MIN_TAG_WIDTH_PT || spec.height_pt < TAG_TOP_INSET_PT + 20.0 {
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
    let expected_height = f32::from(tag_strip_length_tenths_mm(tags)?) * 72.0 / 254.0;
    if (spec.height_pt - expected_height).abs() > 0.1 {
        return Err(PrintError::Invalid(
            "the TSC page size does not match the selected tag batch length".into(),
        ));
    }
    layout_tag_strip(tags, spec, meter).map(|page| vec![page])
}

/// Which optional branding lines one attempt prints.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct TagBranding {
    shop_name: bool,
    tag_line: bool,
}

/// Everything that stays the same while one strip is tried at different font sizes.
struct TagStrip<'a> {
    tags: &'a TagDocument,
    /// Sorted by position, so index 0 is the first tag down the strip.
    pieces: Vec<&'a TagPiece>,
    content_width_pt: f32,
    pitch_pt: f32,
    tail_pt: f32,
    meter: &'a dyn TextMeter,
}

impl TagStrip<'_> {
    /// Lays out every tag at one font size and branding choice. Returns `None` when some tag's
    /// text does not fit inside its own pitch.
    fn lay_out(&self, sizes: (f32, f32, f32), branding: TagBranding) -> Option<Vec<StyledLine>> {
        let (small, _, _) = sizes;
        let customer = customer_blocks(self.tags, small, self.content_width_pt, self.meter);
        let mut lines = Vec::new();
        for (index, piece) in self.pieces.iter().enumerate() {
            // Each tag owns one pitch of the strip. Its text starts TAG_TOP_INSET_PT below the top
            // of that slot, so the tag fits only when its bottom edge is still inside the slot.
            let slot_top = self.tail_pt + index as f32 * self.pitch_pt;
            let start_y = slot_top + TAG_TOP_INSET_PT;
            let mut y = start_y;
            let blocks = tag_blocks(self.tags, piece, sizes, branding, &customer);
            for (text, size, bold) in blocks {
                for wrapped in wrap_text(&text, self.content_width_pt, size, bold, self.meter) {
                    lines.push(StyledLine {
                        text: wrapped,
                        size_pt: size,
                        bold,
                        x_pt: TAG_LEFT_INSET_PT,
                        y_pt: y,
                    });
                    y += size * POINTS_PER_LINE_HEIGHT;
                }
            }
            if (y - start_y) + TAG_TOP_INSET_PT > self.pitch_pt {
                return None;
            }
        }
        Some(lines)
    }
}

fn layout_tag_strip(
    tags: &TagDocument,
    spec: PageSpec,
    meter: &dyn TextMeter,
) -> Result<LaidOutPage, PrintError> {
    // TSC physically delivers the reverse of this PDF-order strip. Sorting by the stable
    // piece position makes Piece 1 the physical final tag, where the extra tail belongs.
    let mut pieces: Vec<&TagPiece> = tags.pieces.iter().collect();
    pieces.sort_by_key(|piece| piece.position);
    let strip = TagStrip {
        tags,
        pieces,
        content_width_pt: spec.width_pt - TAG_LEFT_INSET_PT - TAG_RIGHT_INSET_PT,
        pitch_pt: f32::from(tags.tag_length_tenths_mm) * 72.0 / 254.0,
        tail_pt: f32::from(TAG_FINAL_TAIL_TENTHS_MM) * 72.0 / 254.0,
        meter,
    };
    // The full branding is tried at every font step before any branding line is dropped.
    for branding in TAG_BRANDING_ATTEMPTS {
        for sizes in TAG_SIZE_STEPS {
            if let Some(lines) = strip.lay_out(sizes, branding) {
                return Ok(LaidOutPage {
                    margin_pt: TAG_LEFT_INSET_PT,
                    right_margin_pt: TAG_RIGHT_INSET_PT,
                    bottom_reserved_pt: 0.0,
                    rules: Vec::new(),
                    lines,
                });
            }
        }
    }
    Err(PrintError::Invalid(
        "the text for one or more tags does not fit within the configured tag pitch".into(),
    ))
}

/// The customer name as printed on a tag: safe text, cut to `TAG_CUSTOMER_NAME_MAX_CHARS`
/// characters with a trailing ellipsis. Empty when no name was saved.
pub(crate) fn tag_customer_name(name: &str) -> String {
    let name = safe_text(name);
    if name.chars().count() <= TAG_CUSTOMER_NAME_MAX_CHARS {
        return name;
    }
    let kept: String = name.chars().take(TAG_CUSTOMER_NAME_MAX_CHARS - 1).collect();
    format!("{}\u{2026}", kept.trim_end())
}

/// The customer phone as printed on a tag: safe text, cut to `TAG_CUSTOMER_PHONE_MAX_CHARS`
/// characters. Empty when no phone was saved.
pub(crate) fn tag_customer_phone(phone: &str) -> String {
    safe_text(phone)
        .chars()
        .take(TAG_CUSTOMER_PHONE_MAX_CHARS)
        .collect()
}

/// Cuts `text` with a trailing ellipsis until it fits on one line of `max_width_pt`. Used for
/// the customer name, which must never wrap onto a second line.
fn fit_one_line(
    text: &str,
    max_width_pt: f32,
    size_pt: f32,
    bold: bool,
    meter: &dyn TextMeter,
) -> String {
    if meter.width_pt(text, size_pt, bold) <= max_width_pt {
        return text.to_owned();
    }
    let chars: Vec<char> = text.chars().collect();
    for kept in (0..chars.len()).rev() {
        let prefix: String = chars[..kept].iter().collect();
        let candidate = format!("{}\u{2026}", prefix.trim_end());
        if meter.width_pt(&candidate, size_pt, bold) <= max_width_pt {
            return candidate;
        }
    }
    "\u{2026}".to_owned()
}

/// Customer name and phone lines for every tag at one font size. Empty details are left out.
///
/// The rule is fixed: the name is cut to one line. Name and phone share one line, joined by a
/// middle dot, when that line fits the tag width measured in bold, which is the wider style.
/// Otherwise the name and the phone take one line each. The shared line is never taller than
/// the two-line form, so it is always preferred when it fits.
fn customer_blocks(
    tags: &TagDocument,
    size: f32,
    content_width: f32,
    meter: &dyn TextMeter,
) -> Vec<(String, f32, bool)> {
    let name = fit_one_line(
        &tag_customer_name(&tags.customer_name),
        content_width,
        size,
        true,
        meter,
    );
    let phone = tag_customer_phone(&tags.customer_phone);
    match (name.is_empty(), phone.is_empty()) {
        (true, true) => Vec::new(),
        (false, true) => vec![(name, size, true)],
        (true, false) => vec![(phone, size, false)],
        (false, false) => {
            let shared = format!("{name} \u{b7} {phone}");
            if meter.width_pt(&shared, size, true) <= content_width {
                vec![(shared, size, true)]
            } else {
                vec![(name, size, true), (phone, size, false)]
            }
        }
    }
}

/// The text blocks of one tag, top to bottom, as (text, point size, bold). Shop name, tag line,
/// bill, customer, garment, service, piece and ID, in that order. Branding lines are included
/// only when the attempt allows them and the tag has them set.
fn tag_blocks(
    tags: &TagDocument,
    piece: &TagPiece,
    (small, large, id_size): (f32, f32, f32),
    branding: TagBranding,
    customer: &[(String, f32, bool)],
) -> Vec<(String, f32, bool)> {
    let mut blocks = Vec::new();
    let shop_name = safe_text(&tags.shop_name);
    if branding.shop_name && tags.show_shop_name && !shop_name.is_empty() {
        blocks.push((shop_name, small, true));
    }
    let tag_line = safe_text(&tags.tag_line);
    if branding.tag_line && !tag_line.is_empty() {
        blocks.push((tag_line, small, false));
    }
    blocks.push((
        format!("Bill {}", safe_text(&tags.order_number)),
        small,
        true,
    ));
    blocks.extend(customer.iter().cloned());
    blocks.extend([
        (safe_text(&piece.garment), large, true),
        (safe_text(&piece.service), large, false),
        (
            format!("Piece {}/{}", piece.position, piece.total),
            large,
            true,
        ),
        (format!("ID {}", safe_text(&piece.piece_id)), id_size, false),
    ]);
    blocks
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
        width_pt: 842.0,
        height_pt: 595.0,
    };
    const TAG: PageSpec = PageSpec {
        width_pt: 141.0,
        height_pt: 1116.0 * 72.0 / 254.0,
    };

    fn bill(items: usize) -> BillDocument {
        BillDocument {
            header: BillHeader::default(),
            order_number: "LA-2026-00123".into(),
            created_at_ist: "15 Oct 2026 10:30 AM".into(),
            promised_at_ist: "17 Oct 2026 05:00 PM".into(),
            customer_name: "Test Customer".into(),
            customer_phone: "TEST-PHONE".into(),
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
            ..TagDocument::default()
        }
    }

    fn tag_spec(document: &TagDocument) -> PageSpec {
        PageSpec {
            width_pt: TAG.width_pt,
            height_pt: tag_strip_length_tenths_mm(document).unwrap() as f32 * 72.0 / 254.0,
        }
    }

    fn texts(page: &LaidOutPage) -> Vec<&str> {
        page.lines.iter().map(|l| l.text.as_str()).collect()
    }

    /// The last page of a bill ends with its footer line, and carries the fixed Marathi terms in a
    /// block that starts level with the totals, to their left, and ends above the footer.
    fn assert_ends_with_footer_then_terms(page: &LaidOutPage, footer: &str) {
        let lines = texts(page);
        assert_eq!(lines.last(), Some(&footer), "{lines:?}");
        let terms: Vec<&StyledLine> = BILL_TERMS
            .iter()
            .map(|term| {
                page.lines
                    .iter()
                    .find(|line| line.text == *term)
                    .unwrap_or_else(|| panic!("terms line {term:?} is missing: {lines:?}"))
            })
            .collect();
        let footer_line = page.lines.last().unwrap();
        assert!(terms.windows(2).all(|pair| pair[0].y_pt < pair[1].y_pt));
        assert!(
            terms.last().unwrap().y_pt < footer_line.y_pt,
            "terms end above the footer"
        );
        let total = page
            .lines
            .iter()
            .find(|line| line.text.starts_with("Total: "))
            .unwrap();
        assert!(
            terms.iter().all(|term| term.size_pt < footer_line.size_pt),
            "terms are smaller than the footer"
        );
        assert!(
            terms[0].y_pt <= total.y_pt + 0.1,
            "terms start level with the totals"
        );
    }

    fn assert_within(page: &LaidOutPage, spec: PageSpec) {
        for rule in &page.rules {
            assert!(
                rule.x1_pt >= page.margin_pt && rule.x2_pt <= spec.width_pt - page.right_margin_pt
            );
            assert!(rule.x2_pt > rule.x1_pt);
            assert!(
                rule.y_pt >= page.margin_pt
                    && rule.y_pt <= spec.height_pt - page.bottom_reserved_pt
            );
        }
        for line in &page.lines {
            assert!(
                line.x_pt + 0.01 >= page.margin_pt,
                "line starts before left margin: {}",
                line.text
            );
            assert!(
                line.x_pt + FakeMeter.width_pt(&line.text, line.size_pt, line.bold)
                    <= spec.width_pt - page.right_margin_pt + 0.01,
                "line too wide: {}",
                line.text
            );
            assert!(
                line.y_pt >= page.margin_pt
                    && line.y_pt + line.size_pt <= spec.height_pt - page.bottom_reserved_pt + 0.01,
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
        assert!(pages[0].lines.iter().all(|l| l.size_pt <= 22.0));
        let lines = texts(&pages[0]);
        assert!(lines.contains(&"Total: \u{20b9}50.00"));
        assert!(lines.contains(&"Ready by: 17 Oct 2026 05:00 PM"));
        assert!(lines.iter().any(|l| l == &"Balance due: \u{20b9}0.00"));
        assert!(!lines.iter().any(|l| l.starts_with("Discount")));
        for column in ["Particulars", "Service", "Qty", "Rate", "Amount"] {
            assert!(
                lines.contains(&column),
                "missing full-width table column {column}"
            );
        }
        let header_x: Vec<_> = ["Particulars", "Service", "Qty", "Rate", "Amount"]
            .iter()
            .map(|column| {
                pages[0]
                    .lines
                    .iter()
                    .find(|line| line.text == *column)
                    .unwrap()
                    .x_pt
            })
            .collect();
        assert!(header_x.windows(2).all(|pair| pair[0] < pair[1]));
    }

    #[test]
    fn configured_bill_identity_and_message_are_centered_and_rules_stay_inside_a4() {
        let mut document = bill(1);
        document.header = BillHeader {
            shop_name: "Example Laundry".into(),
            address: "1 Example Lane".into(),
            phone: "PHONE TEST".into(),
            message: "Ready for pickup".into(),
            ..BillHeader::default()
        };
        let pages = layout_bill(&document, A4, &FakeMeter).unwrap();
        let page = &pages[0];
        for label in [
            "Example Laundry",
            "1 Example Lane",
            "Tel: PHONE TEST",
            "Ready for pickup",
        ] {
            let line = page.lines.iter().find(|line| line.text == label).unwrap();
            let center = line.x_pt + FakeMeter.width_pt(&line.text, line.size_pt, line.bold) / 2.0;
            assert!(
                (center - A4.width_pt / 2.0).abs() < 0.01,
                "{label} is not centered"
            );
        }
        assert!(page.rules.len() >= 4);
        assert_within(page, A4);
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
            .filter(|line| {
                line.text
                    .strip_prefix("Garment ")
                    .and_then(|text| text.split_whitespace().next())
                    .is_some_and(|number| number.parse::<usize>().is_ok())
            })
            .count();
        assert_eq!(garments, 40);
        assert_ends_with_footer_then_terms(pages.last().unwrap(), "Thank you");
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
            height_pt: 70.0,
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

    /// A three-tag strip with every branding line and a typical customer set. The garment is long
    /// enough to need the full tag width.
    fn branded_strip(length_tenths_mm: u16) -> TagDocument {
        TagDocument {
            order_number: "LA-2026-00123".into(),
            customer_name: "Priya Sharma".into(),
            customer_phone: "9876543210".into(),
            pieces: (1..=3)
                .map(|position| TagPiece {
                    piece_id: format!("2610170001-{position}"),
                    garment: "Gents Kurta Pyjama".into(),
                    service: "Wash + Iron".into(),
                    position,
                    total: 3,
                })
                .collect(),
            shop_name: "Sunrise Cleaners".into(),
            show_shop_name: true,
            tag_line: "Quality care".into(),
            tag_length_tenths_mm: length_tenths_mm,
        }
    }

    /// Every line must end inside the pitch of the tag it belongs to. A tag's text starts
    /// TAG_TOP_INSET_PT below its slot top, so the bottom edge is measured from the slot top.
    fn assert_no_tag_overflows_its_pitch(page: &LaidOutPage, tags: &TagDocument) {
        let pitch = f32::from(tags.tag_length_tenths_mm) * 72.0 / 254.0;
        let tail = f32::from(TAG_FINAL_TAIL_TENTHS_MM) * 72.0 / 254.0;
        for line in &page.lines {
            let slot_top = tail + ((line.y_pt - tail) / pitch).floor() * pitch;
            let bottom = line.y_pt + line.size_pt * POINTS_PER_LINE_HEIGHT;
            assert!(
                bottom - slot_top <= pitch + 0.01,
                "{:?} ends {:.2} pt into a {:.2} pt tag",
                line.text,
                bottom - slot_top,
                pitch
            );
        }
    }

    #[test]
    fn tag_carries_customer_bill_garment_service_position_and_id() {
        let mut document = tag("Saree", "Dry Clean");
        document.customer_name = "Asha Patil".into();
        document.customer_phone = "9876543210".into();
        let spec = tag_spec(&document);
        let pages = layout_tags(&document, spec, &FakeMeter).unwrap();
        assert_eq!(pages.len(), 1);
        // The name and phone take one line each: the shared line would be too wide here.
        assert_eq!(
            texts(&pages[0]),
            vec![
                "Bill LA-2026-00123",
                "Asha Patil",
                "9876543210",
                "Saree",
                "Dry Clean",
                "Piece 3/4",
                "ID 2600123-3"
            ]
        );
        assert_within(&pages[0], spec);
    }

    #[test]
    fn customer_name_and_phone_share_one_line_when_they_fit() {
        let mut document = tag("Saree", "Dry Clean");
        document.customer_name = "Asha".into();
        document.customer_phone = "98765".into();
        let pages = layout_tags(&document, tag_spec(&document), &FakeMeter).unwrap();
        let lines = texts(&pages[0]);
        assert!(lines.contains(&"Asha \u{b7} 98765"), "{lines:?}");
        assert!(!lines.contains(&"Asha"));
        assert!(!lines.contains(&"98765"));
    }

    #[test]
    fn empty_customer_details_leave_no_blank_lines() {
        let mut document = tag("Saree", "Dry Clean");
        document.customer_name = "   ".into();
        document.customer_phone = String::new();
        let pages = layout_tags(&document, tag_spec(&document), &FakeMeter).unwrap();
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
        assert!(pages[0].lines.iter().all(|l| !l.text.trim().is_empty()));
    }

    #[test]
    fn a_long_customer_name_is_cut_to_one_line_and_keeps_every_tag_pitch() {
        let mut document = branded_strip(300);
        // 100 characters with no spaces: the name cannot wrap at a word boundary.
        document.customer_name = "Ab".repeat(50);
        let spec = tag_spec(&document);
        let pages = layout_tags(&document, spec, &FakeMeter).unwrap();
        let page = &pages[0];
        let names: Vec<&StyledLine> = page
            .lines
            .iter()
            .filter(|line| line.text.starts_with("Ab"))
            .collect();
        assert_eq!(names.len(), 3, "one name line per tag");
        for name in &names {
            assert!(name.text.ends_with('\u{2026}'), "{}", name.text);
            assert!(name.text.chars().count() <= TAG_CUSTOMER_NAME_MAX_CHARS);
        }
        let bills: Vec<f32> = page
            .lines
            .iter()
            .filter(|line| line.text.starts_with("Bill "))
            .map(|line| line.y_pt)
            .collect();
        assert_eq!(bills.len(), 3);
        let pitch = 300.0 * 72.0 / 254.0;
        for pair in bills.windows(2) {
            assert!((pair[1] - pair[0] - pitch).abs() < 0.01);
        }
        assert_within(page, spec);
        assert_no_tag_overflows_its_pitch(page, &document);
    }

    #[test]
    fn a_long_garment_with_customer_details_fits_a_30mm_tag_without_overlap() {
        let mut document = branded_strip(300);
        document.shop_name.clear();
        document.show_shop_name = false;
        document.tag_line.clear();
        let spec = tag_spec(&document);
        let pages = layout_tags(&document, spec, &FakeMeter).unwrap();
        assert_within(&pages[0], spec);
        assert_no_tag_overflows_its_pitch(&pages[0], &document);
        let lines = texts(&pages[0]);
        for position in 1..=3 {
            assert!(lines.contains(&format!("Piece {position}/3").as_str()));
        }
        assert!(lines.contains(&"Priya Sharma"), "{lines:?}");
    }

    #[test]
    fn the_tag_line_is_the_first_branding_line_dropped_at_30mm() {
        let document = branded_strip(300);
        let spec = tag_spec(&document);
        let pages = layout_tags(&document, spec, &FakeMeter).unwrap();
        let lines = texts(&pages[0]);
        assert!(!lines.contains(&"Quality care"), "{lines:?}");
        assert!(lines.contains(&"Sunrise Cleaners"), "{lines:?}");
        assert!(
            lines.contains(&"Priya Sharma \u{b7} 9876543210"),
            "{lines:?}"
        );
        assert!(lines.contains(&"Bill LA-2026-00123"));
        assert!(lines.contains(&"Gents Kurta Pyjama"));
        assert!(lines.contains(&"Wash + Iron"));
        assert!(lines.contains(&"Piece 1/3"));
        assert!(lines.contains(&"ID 2610170001-1"));
        assert_within(&pages[0], spec);
        assert_no_tag_overflows_its_pitch(&pages[0], &document);
    }

    #[test]
    fn the_shop_name_is_dropped_only_after_the_tag_line_when_nothing_else_fits() {
        // The name and phone never share a line here. With the shop name printed, every font step
        // is one small line too tall, so the tag line goes and then the shop name.
        let mut document = branded_strip(300);
        document.customer_name = "Bartholomew Fitzgerald".into();
        document.customer_phone = "+91 9876543210".into();
        let spec = tag_spec(&document);
        let pages = layout_tags(&document, spec, &FakeMeter).unwrap();
        let lines = texts(&pages[0]);
        assert!(!lines.contains(&"Sunrise Cleaners"), "{lines:?}");
        assert!(!lines.contains(&"Quality care"), "{lines:?}");
        assert!(lines.contains(&"Bartholomew Fitzgerald"), "{lines:?}");
        assert!(lines.contains(&"+91 9876543210"), "{lines:?}");
        assert!(lines.contains(&"Bill LA-2026-00123"));
        assert!(lines.contains(&"Gents Kurta Pyjama"));
        assert_within(&pages[0], spec);
        assert_no_tag_overflows_its_pitch(&pages[0], &document);
    }

    #[test]
    fn branding_is_kept_on_longer_tags_and_the_tag_line_goes_first_at_30mm() {
        // Measured with the stand-in meter: at 30 mm the tag line is dropped first, at 40 mm and
        // 50 mm nothing is dropped.
        for (length, expect_tag_line) in [(300, false), (400, true), (500, true)] {
            let document = branded_strip(length);
            let pages = layout_tags(&document, tag_spec(&document), &FakeMeter).unwrap();
            let lines = texts(&pages[0]);
            assert!(lines.contains(&"Sunrise Cleaners"), "{length}: {lines:?}");
            assert_eq!(
                lines.contains(&"Quality care"),
                expect_tag_line,
                "{length}: {lines:?}"
            );
        }
    }

    #[test]
    fn a_tag_that_cannot_fit_is_refused_after_every_branding_drop() {
        let mut document = branded_strip(300);
        document.pieces[0].garment = "W".repeat(400);
        let spec = tag_spec(&document);
        assert!(matches!(
            layout_tags(&document, spec, &FakeMeter),
            Err(PrintError::Invalid(message)) if message.contains("configured tag pitch")
        ));
    }

    #[test]
    fn tag_numbers_come_from_the_piece_values_not_the_strip_index() {
        let mut document = tag("Shirt", "Wash");
        document.pieces = [2, 5]
            .into_iter()
            .map(|position| TagPiece {
                piece_id: format!("2600123-{position}"),
                garment: "Shirt".into(),
                service: "Wash".into(),
                position,
                total: 5,
            })
            .collect();
        let pages = layout_tags(&document, tag_spec(&document), &FakeMeter).unwrap();
        let numbers: Vec<&str> = texts(&pages[0])
            .into_iter()
            .filter(|line| line.starts_with("Piece "))
            .collect();
        assert_eq!(numbers, ["Piece 2/5", "Piece 5/5"]);
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
        let pages = layout_tags(&document, tag_spec(&document), &FakeMeter).unwrap();
        assert_eq!(pages.len(), 1);
        let lines = texts(&pages[0]);
        assert!(lines.contains(&"Piece 3/4"));
        assert!(lines.contains(&"Piece 4/4"));
    }

    #[test]
    fn tag_strip_uses_asymmetric_tested_offsets_and_one_ten_mm_physical_tail() {
        let mut document = tag("Shirt", "Wash + Iron");
        document.tag_length_tenths_mm = 300;
        document.pieces = vec![
            TagPiece {
                piece_id: "piece-003".into(),
                garment: "Shirt".into(),
                service: "Wash + Iron".into(),
                position: 3,
                total: 3,
            },
            TagPiece {
                piece_id: "piece-001".into(),
                garment: "Shirt".into(),
                service: "Wash + Iron".into(),
                position: 1,
                total: 3,
            },
            TagPiece {
                piece_id: "piece-002".into(),
                garment: "Shirt".into(),
                service: "Wash + Iron".into(),
                position: 2,
                total: 3,
            },
        ];
        let spec = tag_spec(&document);
        let pages = layout_tags(&document, spec, &FakeMeter).unwrap();
        assert_eq!(pages.len(), 1, "a batch is one continuous strip page");
        let page = &pages[0];
        let first_line = page
            .lines
            .iter()
            .find(|line| line.text == "Bill LA-2026-00123")
            .unwrap();
        assert!((first_line.x_pt - 28.3465).abs() < 0.01, "10 mm left start");
        assert!(
            first_line.x_pt
                + FakeMeter.width_pt(&first_line.text, first_line.size_pt, first_line.bold)
                <= spec.width_pt - 8.5039 + 0.01,
            "text keeps a 3 mm right inset"
        );
        let first_tag_y = first_line.y_pt;
        assert!(
            (first_tag_y - (TAG_FINAL_TAIL_TENTHS_MM as f32 * 72.0 / 254.0 + TAG_TOP_INSET_PT))
                .abs()
                < 0.01
        );
        let piece2_y = page
            .lines
            .iter()
            .filter(|line| line.text == "Bill LA-2026-00123")
            .nth(1)
            .unwrap()
            .y_pt;
        assert!((piece2_y - first_tag_y - 300.0 * 72.0 / 254.0).abs() < 0.01);
        let order: Vec<_> = page
            .lines
            .iter()
            .filter(|line| line.text.starts_with("Piece "))
            .map(|line| line.text.as_str())
            .collect();
        assert_eq!(order, ["Piece 1/3", "Piece 2/3", "Piece 3/3"]);
        assert_within(page, spec);
        let expected_height = 3.0 * 300.0 * 72.0 / 254.0 + 100.0 * 72.0 / 254.0;
        assert!((spec.height_pt - expected_height).abs() < 0.01);
    }

    #[test]
    fn tag_strip_rejects_a_batch_longer_than_the_driver_page_length_limit() {
        let mut document = tag("Shirt", "Wash");
        document.pieces = (1..=33)
            .map(|position| TagPiece {
                piece_id: format!("piece-{position}"),
                garment: "Shirt".into(),
                service: "Wash".into(),
                position,
                total: 33,
            })
            .collect();
        assert!(matches!(
            tag_strip_length_tenths_mm(&document),
            Err(PrintError::Invalid(message)) if message.contains("maximum continuous strip length")
        ));
    }

    #[test]
    fn long_tag_text_wraps_or_shrinks_to_fit_a_short_label() {
        let mut document = tag("Kurta / Kameez with embroidery", "Wash + Iron");
        document.tag_length_tenths_mm = 400;
        let short_label = tag_spec(&document);
        let pages = layout_tags(&document, short_label, &FakeMeter).unwrap();
        assert_within(&pages[0], short_label);
        assert!(pages[0].lines.iter().any(|l| l.size_pt < 12.0));
    }

    #[test]
    fn unfittable_tag_text_fails_cleanly_and_tiny_labels_are_rejected() {
        let hopeless = tag(&"W".repeat(400), "Wash");
        let mut hopeless = hopeless;
        hopeless.tag_length_tenths_mm = 300;
        let short_tag = tag_spec(&hopeless);
        assert!(matches!(
            layout_tags(&hopeless, short_tag, &FakeMeter),
            Err(PrintError::Invalid(message)) if message.contains("configured tag pitch")
        ));
        let tiny = PageSpec {
            width_pt: 40.0,
            height_pt: TAG.height_pt,
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
            height_pt: TAG.height_pt,
        };
        let one_tag = tag("Shirt", "Wash");
        assert!(layout_tags(&one_tag, four_by_six, &FakeMeter).is_ok());
    }

    #[test]
    fn the_piece_id_never_shrinks_below_eight_points() {
        let mut document = tag("Kurta / Kameez with embroidery", "Wash + Iron");
        document.tag_length_tenths_mm = 400;
        let short_label = tag_spec(&document);
        let pages = layout_tags(&document, short_label, &FakeMeter).unwrap();
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
        let tag_document = tag("Shirt", "Wash");
        let tag_pages = layout_document(
            &PrintDocument::Tags(tag_document.clone()),
            tag_spec(&tag_document),
            &FakeMeter,
        )
        .unwrap();
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

    #[test]
    fn the_payment_is_an_advance_only_while_a_balance_remains() {
        let mut partly_paid = bill(1);
        partly_paid.paid_minor = 2500;
        partly_paid.balance_minor = 2500;
        let pages = layout_bill(&partly_paid, A4, &FakeMeter).unwrap();
        let lines = texts(&pages[0]);
        assert!(lines.contains(&"Paid so far: \u{20b9}25.00"), "{lines:?}");
        assert!(!lines.contains(&"Paid: \u{20b9}25.00"), "{lines:?}");
        assert!(lines.contains(&"Balance due: \u{20b9}25.00"), "{lines:?}");

        let pages = layout_bill(&bill(1), A4, &FakeMeter).unwrap();
        let lines = texts(&pages[0]);
        assert!(lines.contains(&"Paid: \u{20b9}50.00"), "{lines:?}");
        assert!(!lines.iter().any(|l| l.contains("so far")), "{lines:?}");
    }

    const BILL_SMALL_LANDSCAPE: PageSpec = PageSpec {
        width_pt: 566.0,
        height_pt: 425.0,
    };

    fn full_header() -> BillHeader {
        BillHeader {
            shop_name: "Example Cleaners".into(),
            address: "12 Example Road, Test City".into(),
            phone: "PHONE TEST".into(),
            footer: "Visit again soon".into(),
            ..BillHeader::default()
        }
    }

    #[test]
    fn bill_header_prints_name_address_and_phone_above_the_bill_number() {
        let mut document = bill(1);
        document.header = full_header();
        let pages = layout_bill(&document, A4, &FakeMeter).unwrap();
        let lines = texts(&pages[0]);
        assert_eq!(
            lines[..4],
            [
                "Example Cleaners",
                "12 Example Road, Test City",
                "Tel: PHONE TEST",
                "Bill: LA-2026-00123"
            ]
        );
        assert_eq!(pages[0].lines[0].size_pt, 18.0);
        assert!(pages[0].lines[1].size_pt < pages[0].lines[0].size_pt);
        assert!(!lines.contains(&"SMART LAUNDRY"));
        assert_ends_with_footer_then_terms(&pages[0], "Visit again soon");
        assert!(!lines.contains(&"Thank you"));
    }

    #[test]
    fn empty_header_fields_are_omitted_and_defaults_apply() {
        let mut document = bill(1);
        document.header = BillHeader {
            shop_name: "  ".into(),
            address: "".into(),
            phone: "\n".into(),
            footer: " ".into(),
            ..BillHeader::default()
        };
        let pages = layout_bill(&document, A4, &FakeMeter).unwrap();
        let lines = texts(&pages[0]);
        assert_eq!(lines[0], "SMART LAUNDRY");
        assert_eq!(lines[1], "Bill: LA-2026-00123");
        assert!(!lines.iter().any(|l| l.starts_with("Tel")));
        assert_ends_with_footer_then_terms(&pages[0], "Thank you");
        let name_only = BillHeader {
            shop_name: "Only Name".into(),
            ..BillHeader::default()
        };
        document.header = name_only;
        let pages = layout_bill(&document, A4, &FakeMeter).unwrap();
        assert_eq!(texts(&pages[0])[..2], ["Only Name", "Bill: LA-2026-00123"]);
    }

    #[test]
    fn long_shop_name_address_and_footer_wrap_on_a_smaller_landscape_page() {
        let mut document = bill(1);
        document.header = BillHeader {
            shop_name: "Sunrise Premium Dry Cleaners And Laundry Services".into(),
            address: "Shop 12, Ground Floor, Sample Road, Test City".into(),
            phone: "PHONE TEST".into(),
            footer: "Thank you for choosing us. Collect within 30 days or items may be donated."
                .into(),
            ..BillHeader::default()
        };
        let pages = layout_bill(&document, BILL_SMALL_LANDSCAPE, &FakeMeter).unwrap();
        for page in &pages {
            assert_within(page, BILL_SMALL_LANDSCAPE);
        }
        let first = texts(&pages[0]);
        let name_lines = first.iter().take_while(|l| !l.starts_with("Shop")).count();
        assert!(name_lines > 1, "a long shop name wraps: {first:?}");
        let joined = pages
            .iter()
            .flat_map(|p| p.lines.iter())
            .map(|l| l.text.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        assert!(joined.contains("Collect within 30 days"));
        assert!(joined.contains("Sample Road"));
    }

    const A5_LANDSCAPE: PageSpec = PageSpec {
        width_pt: 595.28,
        height_pt: 419.53,
    };

    fn a5_bill(items: usize) -> BillDocument {
        let mut document = bill(items);
        document.header = full_header();
        document
    }

    fn item_row_size(pages: &[LaidOutPage]) -> Option<f32> {
        pages
            .iter()
            .flat_map(|page| page.lines.iter())
            .find(|line| line.text == "Garment 0")
            .map(|line| line.size_pt)
    }

    fn garment_count(pages: &[LaidOutPage]) -> usize {
        pages
            .iter()
            .flat_map(|page| page.lines.iter())
            .filter(|line| line.text.starts_with("Garment "))
            .count()
    }

    #[test]
    fn a_bill_with_a_few_items_stays_on_one_a5_page_at_the_normal_size() {
        for items in 1..=4 {
            let pages = layout_bill(&a5_bill(items), A5_LANDSCAPE, &FakeMeter).unwrap();
            assert_eq!(pages.len(), 1, "{items} items");
            assert_eq!(item_row_size(&pages), Some(10.0), "{items} items");
            assert_within(&pages[0], A5_LANDSCAPE);
        }
    }

    #[test]
    fn a_bill_that_does_not_fit_at_the_normal_size_shrinks_its_rows_to_stay_on_one_page() {
        // Six items are the most that fit one A5 page at the smallest row size once the terms
        // (beside the totals) take their room; seven items continue onto a second page.
        let pages = layout_bill(&a5_bill(6), A5_LANDSCAPE, &FakeMeter).unwrap();
        assert_eq!(pages.len(), 1);
        let size = item_row_size(&pages).unwrap();
        assert!((7.0..10.0).contains(&size), "row size {size}");
        assert_within(&pages[0], A5_LANDSCAPE);
        assert_eq!(garment_count(&pages), 6);
        let lines = texts(&pages[0]);
        assert!(lines.contains(&"Example Cleaners"), "header is on the page");
        assert!(lines.contains(&"Visit again soon"), "footer is on the page");
        assert!(
            lines.iter().any(|l| l.starts_with("Total: ")),
            "totals are on the page"
        );
        assert_eq!(
            layout_bill(&a5_bill(7), A5_LANDSCAPE, &FakeMeter)
                .unwrap()
                .len(),
            2
        );
    }

    #[test]
    fn row_size_only_shrinks_as_items_grow_and_never_goes_below_seven_points() {
        let mut previous = f32::MAX;
        for items in 1..=30 {
            let pages = layout_bill(&a5_bill(items), A5_LANDSCAPE, &FakeMeter).unwrap();
            let size = item_row_size(&pages).unwrap();
            assert!(size >= 7.0, "{items} items at {size}pt");
            assert!(
                size <= previous,
                "{items} items grew from {previous} to {size}"
            );
            previous = size;
            assert_eq!(garment_count(&pages), items);
            for page in &pages {
                assert_within(page, A5_LANDSCAPE);
            }
            let sizes: Vec<f32> = pages
                .iter()
                .flat_map(|page| page.lines.iter())
                .filter(|line| line.text.starts_with("Garment "))
                .map(|line| line.size_pt)
                .collect();
            assert!(sizes.iter().all(|s| *s == size), "{items} items mix sizes");
        }
    }

    #[test]
    fn a_bill_too_long_even_at_the_smallest_size_continues_on_the_next_page() {
        let pages = layout_bill(&a5_bill(8), A5_LANDSCAPE, &FakeMeter).unwrap();
        assert_eq!(pages.len(), 2);
        assert_eq!(item_row_size(&pages), Some(7.0));
        assert!(pages[1].lines[0].text.ends_with("(continued)"));
        assert_eq!(garment_count(&pages), 8);
        assert!(texts(&pages[1]).contains(&"Visit again soon"));
        for page in &pages {
            assert_within(page, A5_LANDSCAPE);
        }
    }

    #[test]
    fn every_bill_ends_with_the_terms_below_the_footer() {
        // Custom footer on one page, the default thank-you, and a bill that runs to a second A5 page.
        let pages = layout_bill(&a5_bill(1), A5_LANDSCAPE, &FakeMeter).unwrap();
        assert_ends_with_footer_then_terms(pages.last().unwrap(), "Visit again soon");

        let pages = layout_bill(&bill(1), A4, &FakeMeter).unwrap();
        assert_ends_with_footer_then_terms(pages.last().unwrap(), "Thank you");

        let pages = layout_bill(&a5_bill(8), A5_LANDSCAPE, &FakeMeter).unwrap();
        assert_eq!(pages.len(), 2);
        assert_ends_with_footer_then_terms(&pages[1], "Visit again soon");
        assert!(!texts(&pages[0]).contains(&BILL_TERMS[0]));
    }

    #[test]
    fn the_terms_stay_inside_the_margin_for_every_bill_length() {
        for items in 1..=30 {
            let pages = layout_bill(&a5_bill(items), A5_LANDSCAPE, &FakeMeter).unwrap();
            for page in &pages {
                assert_within(page, A5_LANDSCAPE);
            }
            assert_ends_with_footer_then_terms(pages.last().unwrap(), "Visit again soon");
        }
    }

    #[test]
    fn header_is_on_the_first_page_and_footer_on_the_last_page_only() {
        let mut document = bill(40);
        document.header = full_header();
        let pages = layout_bill(&document, A4, &FakeMeter).unwrap();
        assert!(pages.len() > 1);
        let count = |page: &LaidOutPage, needle: &str| {
            page.lines.iter().filter(|l| l.text == needle).count()
        };
        assert_eq!(count(&pages[0], "Example Cleaners"), 1);
        assert_eq!(count(&pages[0], "Visit again soon"), 0);
        for page in &pages[1..] {
            assert_eq!(count(page, "Example Cleaners"), 0);
            assert_eq!(count(page, "Tel: PHONE TEST"), 0);
        }
        let last = pages.last().unwrap();
        assert_eq!(count(last, "Visit again soon"), 1);
        let footer_total: usize = pages.iter().map(|p| count(p, "Visit again soon")).sum();
        assert_eq!(footer_total, 1);
        for page in &pages {
            assert_within(page, A4);
        }
    }

    #[test]
    fn header_control_characters_cannot_reach_the_printer() {
        let header = BillHeader {
            shop_name: "Shop\u{1b}[0mName".into(),
            address: "Line1\nLine2".into(),
            phone: "\u{7}".into(),
            footer: "Bye\r\n".into(),
            ..BillHeader::default()
        };
        assert_eq!(bill_title(&header), "Shop [0mName");
        assert_eq!(bill_header_lines(&header), vec!["Line1 Line2"]);
        assert_eq!(bill_footer(&header), "Bye");
    }
}
