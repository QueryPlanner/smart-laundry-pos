//! Native printer queue discovery and document submission.
//!
//! Printer identifiers are operating-system queue names. They are never used to
//! change the user's default printer. The renderer submits structured documents;
//! customer text is drawn as text and is never interpreted as printer commands.

#[cfg(any(target_os = "linux", test))]
use crate::print_layout::format_money;
#[cfg(any(target_os = "windows", target_os = "linux", test))]
use crate::print_layout::safe_text;
#[cfg(any(target_os = "linux", test))]
use crate::print_layout::{bill_footer_lines, bill_header_lines, bill_message, bill_title};
use serde::{Deserialize, Serialize};
use std::fmt;
#[cfg(any(target_os = "windows", test))]
use std::mem::{align_of, size_of};
use std::time::Duration;

#[cfg(any(target_os = "windows", test))]
use crate::print_layout::{LaidOutPage, PageSpec, TextMeter};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrinterInfo {
    pub id: String,
    pub name: String,
    pub is_default: bool,
    pub is_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BillItem {
    pub garment: String,
    pub service: String,
    pub quantity: u32,
    pub unit_price_minor: i64,
    pub line_total_minor: i64,
}

/// Shop identity printed on a bill, copied from the shop settings when the order is saved so that
/// a reprint matches the original bill even after the settings change. Every field may be empty
/// (and all are for bills saved before shop settings existed): an empty shop name falls back to
/// the built-in title, and empty address, phone and footer lines are simply left out.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BillHeader {
    #[serde(default)]
    pub shop_name: String,
    #[serde(default)]
    pub address: String,
    #[serde(default)]
    pub phone: String,
    /// Editable one-line message printed below the centered shop identity.
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub footer: String,
    /// Visibility choices are copied into the bill at save time. Missing fields in older saved
    /// bills use `true`, preserving the content those bills printed before these controls existed.
    #[serde(default = "default_true")]
    pub show_shop_name: bool,
    #[serde(default = "default_true")]
    pub show_shop_address: bool,
    #[serde(default = "default_true")]
    pub show_shop_phone: bool,
    #[serde(default = "default_true")]
    pub show_customer_phone: bool,
    #[serde(default = "default_true")]
    pub show_received_at: bool,
    #[serde(default = "default_true")]
    pub show_ready_by: bool,
}

fn default_true() -> bool {
    true
}

impl Default for BillHeader {
    fn default() -> Self {
        Self {
            shop_name: String::new(),
            address: String::new(),
            phone: String::new(),
            message: String::new(),
            footer: String::new(),
            show_shop_name: true,
            show_shop_address: true,
            show_shop_phone: true,
            show_customer_phone: true,
            show_received_at: true,
            show_ready_by: true,
        }
    }
}

/// Longest header or footer text a bill document may carry; the settings screen allows less.
pub(crate) const MAX_HEADER_FIELD_CHARS: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BillDocument {
    /// Absent in documents saved before shop settings were printed.
    #[serde(default)]
    pub header: BillHeader,
    pub order_number: String,
    pub created_at_ist: String,
    pub promised_at_ist: String,
    pub customer_name: String,
    pub customer_phone: String,
    pub items: Vec<BillItem>,
    pub subtotal_minor: i64,
    /// Automatic discount in basis points; absent in documents saved before discounts existed.
    #[serde(default)]
    pub discount_percent_bp: i64,
    #[serde(default)]
    pub discount_minor: i64,
    pub paid_minor: i64,
    pub balance_minor: i64,
    pub physical_piece_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TagPiece {
    pub piece_id: String,
    pub garment: String,
    pub service: String,
    pub position: u32,
    pub total: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TagDocument {
    pub order_number: String,
    pub pieces: Vec<TagPiece>,
    /// New tag branding is snapshotted so a reprint matches the original. Old documents omit it.
    #[serde(default)]
    pub shop_name: String,
    #[serde(default)]
    pub show_shop_name: bool,
    #[serde(default)]
    pub tag_line: String,
    /// Millimetres, serialized as a decimal (for example 101.6). Old documents retain the
    /// previous queue default of 101.6 mm.
    #[serde(
        default = "default_tag_length_tenths_mm",
        with = "tenths_mm",
        rename = "tagLengthMm"
    )]
    pub tag_length_tenths_mm: u16,
}

impl Default for TagDocument {
    fn default() -> Self {
        Self {
            order_number: String::new(),
            pieces: Vec::new(),
            shop_name: String::new(),
            show_shop_name: false,
            tag_line: String::new(),
            tag_length_tenths_mm: default_tag_length_tenths_mm(),
        }
    }
}

fn default_tag_length_tenths_mm() -> u16 {
    1016
}

/// Store tenths internally to keep the persisted model exactly comparable while exposing a
/// human-friendly decimal millimetre value to the UI and saved JSON.
pub(crate) mod tenths_mm {
    use serde::{de::Error, Deserialize, Deserializer, Serializer};

    pub fn serialize<S>(value: &u16, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_f64(f64::from(*value) / 10.0)
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<u16, D::Error>
    where
        D: Deserializer<'de>,
    {
        let mm = f64::deserialize(deserializer)?;
        if !mm.is_finite() || mm < 0.0 || mm > f64::from(u16::MAX) / 10.0 {
            return Err(D::Error::custom(
                "tag length must be a finite millimetre value",
            ));
        }
        let tenths = (mm * 10.0).round();
        if (mm * 10.0 - tenths).abs() > 0.001 {
            return Err(D::Error::custom(
                "tag length must use at most one decimal place",
            ));
        }
        Ok(tenths as u16)
    }
}

// A bill is built once per order and consumed immediately, so the size gap between the two
// variants costs nothing worth boxing for.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", content = "document", rename_all = "camelCase")]
pub enum PrintDocument {
    Bill(BillDocument),
    Tags(TagDocument),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubmitDocumentRequest {
    pub printer_id: String,
    pub document: PrintDocument,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SubmissionCertainty {
    Accepted,
    Uncertain,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubmissionReceipt {
    pub os_job_id: Option<String>,
    pub accepted_at: String,
    pub certainty: SubmissionCertainty,
    pub detail: Option<String>,
}

#[derive(Debug)]
pub enum PrintError {
    Invalid(String),
    PrinterUnavailable(String),
    Adapter(String),
    Uncertain(String),
}

/// Windows reports the physical medium and the drawable rectangle separately. Layout uses
/// physical-media coordinates so custom tag lengths are validated against the requested stock;
/// GDI coordinates are then translated to the printable-area origin reported by the driver.
#[cfg(any(target_os = "windows", test))]
#[derive(Debug, Clone, Copy, PartialEq)]
struct PrinterPageGeometry {
    media: PageSpec,
    printable_left_pt: f32,
    printable_top_pt: f32,
    printable_width_pt: f32,
    printable_height_pt: f32,
    x_dpi: i32,
    y_dpi: i32,
}

#[cfg(any(target_os = "windows", test))]
impl PrinterPageGeometry {
    #[allow(clippy::too_many_arguments)]
    fn from_device_caps(
        physical_width_px: i32,
        physical_height_px: i32,
        printable_offset_x_px: i32,
        printable_offset_y_px: i32,
        printable_width_px: i32,
        printable_height_px: i32,
        x_dpi: i32,
        y_dpi: i32,
    ) -> Result<Self, PrintError> {
        if physical_width_px <= 0
            || physical_height_px <= 0
            || printable_width_px <= 0
            || printable_height_px <= 0
            || x_dpi <= 0
            || y_dpi <= 0
            || printable_offset_x_px < 0
            || printable_offset_y_px < 0
            || i64::from(printable_offset_x_px) + i64::from(printable_width_px)
                > i64::from(physical_width_px)
            || i64::from(printable_offset_y_px) + i64::from(printable_height_px)
                > i64::from(physical_height_px)
        {
            return Err(PrintError::Adapter(
                "the printer driver reported inconsistent physical and printable page dimensions"
                    .into(),
            ));
        }
        let x_scale = 72.0 / x_dpi as f32;
        let y_scale = 72.0 / y_dpi as f32;
        Ok(Self {
            media: PageSpec {
                width_pt: physical_width_px as f32 * x_scale,
                height_pt: physical_height_px as f32 * y_scale,
            },
            printable_left_pt: printable_offset_x_px as f32 * x_scale,
            printable_top_pt: printable_offset_y_px as f32 * y_scale,
            printable_width_pt: printable_width_px as f32 * x_scale,
            printable_height_pt: printable_height_px as f32 * y_scale,
            x_dpi,
            y_dpi,
        })
    }

    fn validate_tag_media(mut self, tags: &TagDocument) -> Result<Self, PrintError> {
        const TAG_WIDTH_TENTHS_MM: f32 = 500.0;
        let requested = PageSpec {
            width_pt: TAG_WIDTH_TENTHS_MM * 72.0 / 254.0,
            height_pt: f32::from(crate::print_layout::tag_strip_length_tenths_mm(tags)?) * 72.0
                / 254.0,
        };
        // Device caps are integer pixels. Allow one pixel for conversion/driver rounding, but
        // require the driver to have accepted the requested 50 mm strip and batch length.
        let x_tolerance = 72.0 / self.x_dpi as f32;
        let y_tolerance = 72.0 / self.y_dpi as f32;
        if (self.media.width_pt - requested.width_pt).abs() > x_tolerance
            || (self.media.height_pt - requested.height_pt).abs() > y_tolerance
        {
            return Err(PrintError::Adapter(
                "the TSC driver did not accept the requested 50 mm tag strip dimensions".into(),
            ));
        }
        // Layout against the exact requested media while retaining the driver's measured
        // printable rectangle for clipping checks and coordinate translation.
        self.media = requested;
        Ok(self)
    }

    fn use_requested_bill_media(mut self) -> Self {
        // configured_devmode has already asked DocumentPropertiesW to accept A5 landscape.
        // Keep the requested paper size for layout; use GetDeviceCaps only for the printable
        // rectangle and DPI because some printer drivers report rounded physical dimensions.
        self.media = PageSpec {
            width_pt: 210.0 * 72.0 / 25.4,
            height_pt: 148.0 * 72.0 / 25.4,
        };
        self
    }

    fn validate_layout(
        self,
        pages: &[LaidOutPage],
        meter: &dyn TextMeter,
    ) -> Result<(), PrintError> {
        let right = self.printable_left_pt + self.printable_width_pt;
        let bottom = self.printable_top_pt + self.printable_height_pt;
        let x_tolerance = 36.0 / self.x_dpi as f32;
        let y_tolerance = 36.0 / self.y_dpi as f32;
        for (index, page) in pages.iter().enumerate() {
            for line in &page.lines {
                let line_right = line.x_pt + meter.width_pt(&line.text, line.size_pt, line.bold);
                let line_bottom = line.y_pt + line.size_pt * 1.3;
                if !line_right.is_finite()
                    || line.x_pt < self.printable_left_pt - x_tolerance
                    || line_right > right + x_tolerance
                    || line.y_pt < self.printable_top_pt - y_tolerance
                    || line_bottom > bottom + y_tolerance
                {
                    return Err(PrintError::Adapter(format!(
                        "page {} content extends beyond the printer's drawable area",
                        index + 1
                    )));
                }
            }
            for rule in &page.rules {
                if rule.x1_pt < self.printable_left_pt - x_tolerance
                    || rule.x2_pt > right + x_tolerance
                    || rule.y_pt < self.printable_top_pt - y_tolerance
                    || rule.y_pt > bottom + y_tolerance
                {
                    return Err(PrintError::Adapter(format!(
                        "page {} rule extends beyond the printer's drawable area",
                        index + 1
                    )));
                }
            }
        }
        Ok(())
    }

    /// Converts a physical-media point to a GDI point whose origin is the printable area.
    fn media_point_to_device(self, x_pt: f32, y_pt: f32) -> Result<(i32, i32), PrintError> {
        let x = x_pt - self.printable_left_pt;
        let y = y_pt - self.printable_top_pt;
        if x < 0.0 || y < 0.0 || x > self.printable_width_pt || y > self.printable_height_pt {
            return Err(PrintError::Adapter(
                "print position falls outside the printer's drawable area".into(),
            ));
        }
        Ok((
            (x * self.x_dpi as f32 / 72.0).round() as i32,
            (y * self.y_dpi as f32 / 72.0).round() as i32,
        ))
    }
}

impl fmt::Display for PrintError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Invalid(message) => write!(f, "Invalid print request: {message}"),
            Self::PrinterUnavailable(message) => write!(f, "Printer unavailable: {message}"),
            Self::Adapter(message) => write!(f, "Print adapter failed: {message}"),
            Self::Uncertain(message) => write!(f, "Print submission is uncertain: {message}"),
        }
    }
}

impl std::error::Error for PrintError {}

pub async fn enumerate_printers() -> Result<Vec<PrinterInfo>, PrintError> {
    enumerate_platform_printers()
}

/// How long one document may take to reach the operating-system spooler before the outcome is
/// declared uncertain. The submission keeps running on its own thread; the operator is told to
/// inspect the queue rather than being left with a frozen screen.
const SUBMIT_DEADLINE: Duration = Duration::from_secs(120);
/// A tag batch prints one label at a time, so large batches get a little longer.
const EXTRA_DEADLINE_PER_TAG: Duration = Duration::from_secs(4);
const MAX_DEADLINE: Duration = Duration::from_secs(30 * 60);
/// More tags than this in one order is a data-entry mistake, not a laundry order.
pub(crate) const MAX_TAGS_PER_DOCUMENT: usize = 500;
pub(crate) const MIN_TAG_LENGTH_TENTHS_MM: u16 = 300;
pub(crate) const MAX_TAG_LENGTH_TENTHS_MM: u16 = 2000;
const MAX_TAG_SHOP_NAME_CHARS: usize = 60;
const MAX_TAG_LINE_CHARS: usize = 40;

fn deadline_for(document: &PrintDocument) -> Duration {
    match document {
        PrintDocument::Bill(_) => SUBMIT_DEADLINE,
        PrintDocument::Tags(tags) => {
            let extra = EXTRA_DEADLINE_PER_TAG.saturating_mul(tags.pieces.len() as u32);
            (SUBMIT_DEADLINE + extra).min(MAX_DEADLINE)
        }
    }
}

fn busy_printers() -> &'static std::sync::Mutex<std::collections::HashSet<String>> {
    static BUSY: std::sync::OnceLock<std::sync::Mutex<std::collections::HashSet<String>>> =
        std::sync::OnceLock::new();
    BUSY.get_or_init(Default::default)
}

/// Held by the thread that is talking to one printer queue. If an earlier submission timed out
/// but its thread is still running, a new submission to the same queue is refused instead of
/// racing it, so a late completion can never print a second copy behind the operator's back.
struct PrinterSlot(String);

impl PrinterSlot {
    fn claim(printer_id: &str) -> Result<Self, PrintError> {
        let mut busy = busy_printers()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if !busy.insert(printer_id.to_owned()) {
            return Err(PrintError::PrinterUnavailable(format!(
                "{printer_id}: the previous print to this printer is still running"
            )));
        }
        Ok(Self(printer_id.to_owned()))
    }
}

impl Drop for PrinterSlot {
    fn drop(&mut self) {
        busy_printers()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(&self.0);
    }
}

pub async fn submit_document(
    request: SubmitDocumentRequest,
) -> Result<SubmissionReceipt, PrintError> {
    let deadline = deadline_for(&request.document);
    tauri::async_runtime::spawn_blocking(move || {
        run_with_deadline(deadline, move || submit_blocking(request))
    })
    .await
    .map_err(|error| {
        PrintError::Uncertain(format!("The print task stopped unexpectedly: {error}"))
    })?
}

/// Run blocking printer work on a dedicated thread and give up waiting after `deadline`.
fn run_with_deadline<T: Send + 'static>(
    deadline: Duration,
    work: impl FnOnce() -> Result<T, PrintError> + Send + 'static,
) -> Result<T, PrintError> {
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::Builder::new()
        .name("print-submit".into())
        .spawn(move || {
            let _ = sender.send(work());
        })
        .map_err(|error| {
            PrintError::Adapter(format!("could not start the print worker: {error}"))
        })?;
    match receiver.recv_timeout(deadline) {
        Ok(result) => result,
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => Err(PrintError::Uncertain(
            "The print system did not answer in time. Check the printer queue before retrying."
                .into(),
        )),
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => Err(PrintError::Uncertain(
            "The print worker stopped unexpectedly. Check the printer queue before retrying."
                .into(),
        )),
    }
}

fn submit_blocking(request: SubmitDocumentRequest) -> Result<SubmissionReceipt, PrintError> {
    validate_document(&request.document)?;
    let printers = enumerate_platform_printers()?;
    let printer = printers
        .iter()
        .find(|printer| printer.id == request.printer_id)
        .ok_or_else(|| PrintError::PrinterUnavailable(request.printer_id.clone()))?;
    if !printer.is_available {
        return Err(PrintError::PrinterUnavailable(request.printer_id));
    }
    let _slot = PrinterSlot::claim(&printer.id)?;

    #[cfg(target_os = "windows")]
    {
        windows_adapter::submit(&printer.id, &request.document)
    }
    #[cfg(target_os = "linux")]
    {
        linux_adapter::submit(&printer.id, &request.document)
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        let _ = printer;
        Err(PrintError::Adapter(
            "Printing is only supported on Windows (and Linux for development)".into(),
        ))
    }
}

fn validate_document(document: &PrintDocument) -> Result<(), PrintError> {
    let nonempty = |value: &str, label: &str| {
        if value.trim().is_empty() {
            Err(PrintError::Invalid(format!("{label} cannot be empty")))
        } else {
            Ok(())
        }
    };
    match document {
        PrintDocument::Bill(bill) => {
            nonempty(&bill.order_number, "order number")?;
            nonempty(&bill.customer_name, "customer name")?;
            nonempty(&bill.created_at_ist, "created time")?;
            nonempty(&bill.promised_at_ist, "promised time")?;
            let header = &bill.header;
            if [
                &header.shop_name,
                &header.address,
                &header.phone,
                &header.message,
            ]
            .iter()
            .any(|field| field.chars().count() > MAX_HEADER_FIELD_CHARS)
                || header.footer.chars().count() > MAX_HEADER_FIELD_CHARS * 3
            {
                return Err(PrintError::Invalid("bill header text is too long".into()));
            }
            if bill.physical_piece_count == 0 || bill.items.iter().any(|item| item.quantity == 0) {
                return Err(PrintError::Invalid(
                    "bill quantities must be positive".into(),
                ));
            }
            if bill
                .items
                .iter()
                .any(|item| item.unit_price_minor < 0 || item.line_total_minor < 0)
                || bill.subtotal_minor < 0
                || bill.discount_minor < 0
                || bill.paid_minor < 0
                || bill.balance_minor < 0
            {
                return Err(PrintError::Invalid(
                    "bill amounts cannot be negative".into(),
                ));
            }
            if bill.items.iter().map(|item| item.quantity).sum::<u32>() != bill.physical_piece_count
            {
                return Err(PrintError::Invalid(
                    "bill item quantities do not match physical piece count".into(),
                ));
            }
            let line_sum: Option<i64> = bill
                .items
                .iter()
                .try_fold(0i64, |sum, item| sum.checked_add(item.line_total_minor));
            let lines_priced = bill.items.iter().all(|item| {
                item.unit_price_minor.checked_mul(i64::from(item.quantity))
                    == Some(item.line_total_minor)
            });
            if line_sum != Some(bill.subtotal_minor) || !lines_priced {
                return Err(PrintError::Invalid(
                    "bill line amounts do not add up to the subtotal".into(),
                ));
            }
            if !(0..=10_000).contains(&bill.discount_percent_bp)
                || bill.discount_minor > bill.subtotal_minor
            {
                return Err(PrintError::Invalid("bill discount is out of range".into()));
            }
            let due = bill.subtotal_minor - bill.discount_minor;
            if bill.paid_minor.checked_add(bill.balance_minor) != Some(due) {
                return Err(PrintError::Invalid(
                    "bill paid amount and balance do not match the total".into(),
                ));
            }
            Ok(())
        }
        PrintDocument::Tags(tags) => {
            nonempty(&tags.order_number, "order number")?;
            if !(MIN_TAG_LENGTH_TENTHS_MM..=MAX_TAG_LENGTH_TENTHS_MM)
                .contains(&tags.tag_length_tenths_mm)
            {
                return Err(PrintError::Invalid(
                    "tag cut length must be between 30 and 200 mm".into(),
                ));
            }
            if tags.shop_name.chars().count() > MAX_TAG_SHOP_NAME_CHARS
                || tags.tag_line.chars().count() > MAX_TAG_LINE_CHARS
            {
                return Err(PrintError::Invalid(
                    "tag branding is longer than the configured limit".into(),
                ));
            }
            if tags.pieces.is_empty() || tags.pieces.len() > MAX_TAGS_PER_DOCUMENT {
                return Err(PrintError::Invalid(format!(
                    "a tag document must contain between 1 and {MAX_TAGS_PER_DOCUMENT} pieces"
                )));
            }
            crate::print_layout::tag_strip_length_tenths_mm(tags)?;
            let total = tags.pieces[0].total;
            if total == 0 {
                return Err(PrintError::Invalid(
                    "tag total must be a positive whole-order count".into(),
                ));
            }
            let mut positions = std::collections::HashSet::new();
            let mut piece_ids = std::collections::HashSet::new();
            for piece in &tags.pieces {
                nonempty(&piece.piece_id, "piece ID")?;
                nonempty(&piece.garment, "garment")?;
                nonempty(&piece.service, "service")?;
                if piece.total != total
                    || piece.position == 0
                    || piece.position > total
                    || !positions.insert(piece.position)
                    || !piece_ids.insert(&piece.piece_id)
                {
                    return Err(PrintError::Invalid(
                        "tag pieces must be a unique subset of positions within one whole-order total".into(),
                    ));
                }
            }
            Ok(())
        }
    }
}

#[cfg(any(target_os = "linux", test))]
fn render_lines(document: &PrintDocument) -> Vec<Vec<String>> {
    match document {
        PrintDocument::Bill(bill) => {
            let title = bill_title(&bill.header);
            let mut head: Vec<String> = if title.is_empty() {
                Vec::new()
            } else {
                vec![title]
            };
            head.extend(bill_header_lines(&bill.header));
            let message = bill_message(&bill.header);
            if !message.is_empty() {
                head.push(message);
            }
            let mut lines = vec![head];
            lines[0].push(format!("Bill: {}", safe_text(&bill.order_number)));
            if bill.header.show_received_at {
                lines[0].push(format!("Received: {}", safe_text(&bill.created_at_ist)));
            }
            lines[0].push(format!("Customer: {}", safe_text(&bill.customer_name)));
            if bill.header.show_customer_phone && !bill.customer_phone.trim().is_empty() {
                lines[0].push(format!("Phone: {}", safe_text(&bill.customer_phone)));
            }
            lines[0].push("----------------------------------------".into());
            for item in &bill.items {
                lines[0].push(format!(
                    "{} / {}  x{}",
                    safe_text(&item.garment),
                    safe_text(&item.service),
                    item.quantity
                ));
                lines[0].push(format!(
                    "  {}  {}",
                    format_money(item.unit_price_minor),
                    format_money(item.line_total_minor)
                ));
            }
            lines[0].extend([
                "----------------------------------------".into(),
                format!("Pieces: {}", bill.physical_piece_count),
                format!("Subtotal: {}", format_money(bill.subtotal_minor)),
            ]);
            if bill.discount_minor > 0 {
                lines[0].push(format!("Discount: -{}", format_money(bill.discount_minor)));
            }
            lines[0].extend([
                format!(
                    "Total: {}",
                    format_money(bill.subtotal_minor - bill.discount_minor)
                ),
                format!("Paid: {}", format_money(bill.paid_minor)),
            ]);
            if bill.balance_minor > 0 {
                lines[0].push(format!("Balance: {}", format_money(bill.balance_minor)));
            }
            if bill.header.show_ready_by {
                lines[0].push(format!("Ready by: {}", safe_text(&bill.promised_at_ist)));
            }
            lines[0].extend(bill_footer_lines(&bill.header));
            lines
        }
        PrintDocument::Tags(tags) => tags
            .pieces
            .iter()
            .map(|piece| {
                let mut lines = Vec::new();
                if tags.show_shop_name && !tags.shop_name.trim().is_empty() {
                    lines.push(safe_text(&tags.shop_name));
                }
                if !tags.tag_line.trim().is_empty() {
                    lines.push(safe_text(&tags.tag_line));
                }
                lines.extend([
                    format!("Bill {}", safe_text(&tags.order_number)),
                    format!(
                        "{} / {}",
                        safe_text(&piece.garment),
                        safe_text(&piece.service)
                    ),
                    format!(
                        "Piece {} ({}/{})",
                        safe_text(&piece.piece_id),
                        piece.position,
                        piece.total
                    ),
                ]);
                lines
            })
            .collect(),
    }
}

#[cfg(target_os = "linux")]
mod linux_adapter {
    use super::*;
    use crate::print_layout::{layout_document, tag_strip_length_tenths_mm, PageSpec, TextMeter};
    use cairo::{Context, FontSlant, FontWeight, PdfSurface};
    use std::io::Write;
    use std::process::{Command, Stdio};

    struct CairoMeter<'a>(&'a Context);

    impl TextMeter for CairoMeter<'_> {
        fn width_pt(&self, text: &str, size_pt: f32, bold: bool) -> f32 {
            self.0.select_font_face(
                "Sans",
                FontSlant::Normal,
                if bold {
                    FontWeight::Bold
                } else {
                    FontWeight::Normal
                },
            );
            self.0.set_font_size(f64::from(size_pt));
            self.0
                .text_extents(text)
                .map(|extent| extent.x_advance() as f32)
                .unwrap_or(f32::MAX)
        }
    }

    fn page_spec(document: &PrintDocument) -> Result<PageSpec, PrintError> {
        Ok(match document {
            PrintDocument::Bill(_) => PageSpec {
                width_pt: 841.89,
                height_pt: 595.28,
            },
            PrintDocument::Tags(tags) => PageSpec {
                width_pt: 50.0 * 72.0 / 25.4,
                height_pt: f32::from(tag_strip_length_tenths_mm(tags)?) * 72.0 / 254.0,
            },
        })
    }

    pub(super) fn render_pdf(document: &PrintDocument) -> Result<Vec<u8>, PrintError> {
        let spec = page_spec(document)?;
        let surface = PdfSurface::for_stream(
            f64::from(spec.width_pt),
            f64::from(spec.height_pt),
            Vec::<u8>::new(),
        )
        .map_err(|error| PrintError::Adapter(format!("could not create the print PDF: {error}")))?;
        let context = Context::new(&surface).map_err(|error| {
            PrintError::Adapter(format!("could not create the PDF drawing context: {error}"))
        })?;
        let meter = CairoMeter(&context);
        let pages = layout_document(document, spec, &meter)?;
        for page in &pages {
            context.set_line_width(0.5);
            for rule in &page.rules {
                context.move_to(f64::from(rule.x1_pt), f64::from(rule.y_pt));
                context.line_to(f64::from(rule.x2_pt), f64::from(rule.y_pt));
                context.stroke().map_err(|error| {
                    PrintError::Adapter(format!("could not draw bill rule: {error}"))
                })?;
            }
            for line in &page.lines {
                context.select_font_face(
                    "Sans",
                    FontSlant::Normal,
                    if line.bold {
                        FontWeight::Bold
                    } else {
                        FontWeight::Normal
                    },
                );
                context.set_font_size(f64::from(line.size_pt));
                context.move_to(f64::from(line.x_pt), f64::from(line.y_pt + line.size_pt));
                context.show_text(&line.text).map_err(|error| {
                    PrintError::Adapter(format!("could not draw bill or tag text: {error}"))
                })?;
            }
            context.show_page().map_err(|error| {
                PrintError::Adapter(format!("could not finish a bill or tag page: {error}"))
            })?;
        }
        drop(context);
        surface
            .finish_output_stream()
            .map_err(|error| {
                PrintError::Adapter(format!("could not finish the print PDF: {error}"))
            })?
            .downcast::<Vec<u8>>()
            .map(|bytes| *bytes)
            .map_err(|_| {
                PrintError::Adapter("Cairo returned the print PDF in an unknown format".into())
            })
    }

    pub(super) fn list() -> Result<Vec<PrinterInfo>, PrintError> {
        let output = Command::new("lpstat")
            .args(["-p", "-d"])
            .output()
            .map_err(|error| PrintError::Adapter(format!("could not run lpstat: {error}")))?;
        if !output.status.success() {
            return Err(PrintError::Adapter(
                String::from_utf8_lossy(&output.stderr).trim().to_owned(),
            ));
        }
        let text = String::from_utf8_lossy(&output.stdout);
        let default = text
            .lines()
            .find_map(|line| line.strip_prefix("system default destination: "))
            .map(str::trim);
        let mut printers = Vec::new();
        for line in text.lines() {
            let Some(rest) = line.strip_prefix("printer ") else {
                continue;
            };
            let Some(id) = rest.split_whitespace().next() else {
                continue;
            };
            let lower = line.to_lowercase();
            let available = lower.contains(" is idle")
                || lower.contains(" now printing")
                || lower.contains(" accepting requests");
            printers.push(PrinterInfo {
                id: id.to_owned(),
                name: id.to_owned(),
                is_default: Some(id) == default,
                is_available: available,
            });
        }
        Ok(printers)
    }

    pub(super) fn lp_arguments(
        printer_id: &str,
        document: &PrintDocument,
    ) -> Result<Vec<String>, PrintError> {
        let (media, orientation) = match document {
            PrintDocument::Bill(_) => (
                "media=A5".to_string(),
                "orientation-requested=4".to_string(),
            ),
            PrintDocument::Tags(tags) => (
                format!(
                    "media=Custom.50x{:.1}mm",
                    f64::from(tag_strip_length_tenths_mm(tags)?) / 10.0
                ),
                "orientation-requested=3".to_string(),
            ),
        };
        Ok(vec![
            "-d".into(),
            printer_id.into(),
            "-o".into(),
            "sides=one-sided".into(),
            "-o".into(),
            media.into(),
            "-o".into(),
            orientation,
            "--".into(),
            "-".into(),
        ])
    }

    pub(super) fn cups_job_id(output: &str) -> Option<String> {
        output
            .split_once("request id is ")
            .map(|(_, rest)| {
                rest.split_whitespace()
                    .next()
                    .unwrap_or_default()
                    .to_owned()
            })
            .filter(|id| !id.is_empty())
    }

    pub(super) fn submit(
        printer_id: &str,
        document: &PrintDocument,
    ) -> Result<SubmissionReceipt, PrintError> {
        let body = render_pdf(document)?;
        let mut command = Command::new("lp");
        command
            .args(lp_arguments(printer_id, document)?)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = command
            .spawn()
            .map_err(|error| PrintError::Adapter(format!("could not start CUPS lp: {error}")))?;
        let mut input = child.stdin.take().ok_or_else(|| {
            PrintError::Uncertain(
                "CUPS stdin was not available after starting the print process".into(),
            )
        })?;
        if let Err(error) = input.write_all(&body) {
            drop(input);
            let _ = child.wait_with_output();
            return Err(PrintError::Uncertain(format!(
                "CUPS may have accepted the job before input failed: {error}"
            )));
        }
        drop(input);
        let output = child.wait_with_output().map_err(|error| {
            PrintError::Uncertain(format!(
                "CUPS may have accepted the job before process status was lost: {error}"
            ))
        })?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let job_id = cups_job_id(&stdout);
        if !output.status.success() {
            let detail = format!(
                "CUPS process exited after launch: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            );
            if job_id.is_some() {
                return Ok(SubmissionReceipt {
                    os_job_id: job_id,
                    accepted_at: now_rfc3339(),
                    certainty: SubmissionCertainty::Uncertain,
                    detail: Some(detail),
                });
            }
            return Err(PrintError::Uncertain(detail));
        }
        let Some(job_id) = job_id else {
            return Err(PrintError::Uncertain(
                "CUPS returned success without an OS job identifier".into(),
            ));
        };
        Ok(SubmissionReceipt {
            os_job_id: Some(job_id),
            accepted_at: now_rfc3339(),
            certainty: SubmissionCertainty::Accepted,
            detail: None,
        })
    }
}

#[cfg(target_os = "linux")]
fn enumerate_platform_printers() -> Result<Vec<PrinterInfo>, PrintError> {
    linux_adapter::list()
}

#[cfg(target_os = "windows")]
fn enumerate_platform_printers() -> Result<Vec<PrinterInfo>, PrintError> {
    windows_adapter::list()
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
fn enumerate_platform_printers() -> Result<Vec<PrinterInfo>, PrintError> {
    Err(PrintError::Adapter(
        "printer discovery is not implemented for this operating system".into(),
    ))
}

#[cfg(any(target_os = "linux", target_os = "windows", test))]
fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

#[cfg(any(target_os = "windows", test))]
const PRINTER_ATTRIBUTE_DEFAULT: u32 = 0x0000_0004;
#[cfg(any(target_os = "windows", test))]
const PRINTER_ATTRIBUTE_WORK_OFFLINE: u32 = 0x0000_0400;
/// PRINTER_STATUS_ flags that mean a job sent now would not print: paused, error, being deleted,
/// paper jam/out/problem, offline, not available, needs user intervention, door open.
/// PRINTING (0x400) and BUSY (0x200) are deliberately not here: a queue that is busy printing the
/// previous order still accepts the next one.
#[cfg(any(target_os = "windows", test))]
const PRINTER_UNAVAILABLE_STATUS: u32 = 0x0000_0001
    | 0x0000_0002
    | 0x0000_0004
    | 0x0000_0008
    | 0x0000_0010
    | 0x0000_0040
    | 0x0000_0080
    | 0x0000_1000
    | 0x0010_0000
    | 0x0040_0000;

/// Whether a Windows print queue can take a job right now, from its status and attribute flags.
/// A queue switched to "Use Printer Offline" accepts jobs and never prints them, so it counts.
#[cfg(any(target_os = "windows", test))]
fn printer_is_available(status: u32, attributes: u32) -> bool {
    status & PRINTER_UNAVAILABLE_STATUS == 0 && attributes & PRINTER_ATTRIBUTE_WORK_OFFLINE == 0
}

/// Return only the typed record prefix in a native variable-length Win32 buffer.
///
/// # Safety
/// The caller must ensure the record bytes are initialized as valid `T` values.
#[cfg(any(target_os = "windows", test))]
unsafe fn native_record_prefix<T>(buffer: &[u8], returned: usize) -> Result<&[T], PrintError> {
    let bytes_needed = returned
        .checked_mul(size_of::<T>())
        .ok_or_else(|| PrintError::Adapter("printer record count overflowed".into()))?;
    if bytes_needed > buffer.len() {
        return Err(PrintError::Adapter(
            "printer API returned more records than fit in its buffer".into(),
        ));
    }
    if !(buffer.as_ptr() as usize).is_multiple_of(align_of::<T>()) {
        return Err(PrintError::Adapter(
            "printer API buffer is not aligned for its record type".into(),
        ));
    }
    Ok(std::slice::from_raw_parts(
        buffer.as_ptr().cast::<T>(),
        returned,
    ))
}

#[cfg(any(target_os = "windows", test))]
fn native_utf16z(buffer: &[u8], offset: usize) -> Result<String, PrintError> {
    if offset >= buffer.len() || !offset.is_multiple_of(size_of::<u16>()) {
        return Err(PrintError::Adapter(
            "printer API returned a string pointer outside its buffer".into(),
        ));
    }
    let mut units = Vec::new();
    let mut cursor = offset;
    while cursor + size_of::<u16>() <= buffer.len() {
        let unit = u16::from_ne_bytes([buffer[cursor], buffer[cursor + 1]]);
        if unit == 0 {
            return Ok(String::from_utf16_lossy(&units));
        }
        units.push(unit);
        cursor += size_of::<u16>();
    }
    Err(PrintError::Adapter(
        "printer API returned an unterminated string".into(),
    ))
}

#[cfg(target_os = "windows")]
mod windows_adapter {
    use super::*;
    use crate::print_layout::{layout_document, tag_strip_length_tenths_mm, TextMeter};
    use std::mem::size_of;
    use std::slice;
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::SIZE;
    use windows::Win32::Graphics::Gdi::{
        CreateDCW, CreateFontW, DeleteDC, DeleteObject, GetDeviceCaps, GetTextExtentPoint32W,
        LineTo, MoveToEx, SelectObject, TextOutW, CLIP_DEFAULT_PRECIS, DEFAULT_CHARSET,
        DEFAULT_PITCH, DEFAULT_QUALITY, DEVMODEW, DMORIENT_LANDSCAPE, DMORIENT_PORTRAIT,
        DMPAPER_A5, DMPAPER_USER, DM_IN_BUFFER, DM_ORIENTATION, DM_OUT_BUFFER, DM_PAPERLENGTH,
        DM_PAPERSIZE, DM_PAPERWIDTH, FF_DONTCARE, FW_BOLD, HDC, HFONT, HORZRES, LOGPIXELSX,
        LOGPIXELSY, OUT_DEFAULT_PRECIS, PHYSICALHEIGHT, PHYSICALOFFSETX, PHYSICALOFFSETY,
        PHYSICALWIDTH, VERTRES,
    };
    use windows::Win32::Graphics::Printing::{
        ClosePrinter, DocumentPropertiesW, EnumPrintersW, OpenPrinterW, PRINTER_ENUM_CONNECTIONS,
        PRINTER_ENUM_LOCAL, PRINTER_HANDLE, PRINTER_INFO_2W,
    };
    use windows::Win32::Storage::Xps::{AbortDoc, EndDoc, EndPage, StartDocW, StartPage, DOCINFOW};

    struct PrinterEntries {
        storage: Vec<usize>,
        byte_len: usize,
        returned: usize,
    }

    impl PrinterEntries {
        fn empty() -> Self {
            Self {
                storage: Vec::new(),
                byte_len: 0,
                returned: 0,
            }
        }

        fn bytes(&self) -> &[u8] {
            // Vec<usize> keeps the backing allocation aligned for PRINTER_INFO_2W.
            unsafe { slice::from_raw_parts(self.storage.as_ptr().cast::<u8>(), self.byte_len) }
        }

        fn records(&self) -> Result<&[PRINTER_INFO_2W], PrintError> {
            // EnumPrintersW initializes exactly `returned` leading records. Strings
            // and other pointed-to fields follow those records in the same buffer.
            unsafe { native_record_prefix(self.bytes(), self.returned) }
        }
    }

    fn printer_entries() -> Result<PrinterEntries, PrintError> {
        let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
        let mut needed = 0u32;
        let mut returned = 0u32;
        let query =
            unsafe { EnumPrintersW(flags, PCWSTR::null(), 2, None, &mut needed, &mut returned) };
        if needed == 0 {
            return match query {
                Ok(()) if returned == 0 => Ok(PrinterEntries::empty()),
                Ok(()) => Err(PrintError::Adapter(
                    "EnumPrintersW returned records without a buffer size".into(),
                )),
                Err(error) => Err(PrintError::Adapter(format!(
                    "EnumPrintersW query failed: {error}"
                ))),
            };
        }
        let mut capacity = needed as usize;
        for _ in 0..3 {
            let word_count = capacity.div_ceil(size_of::<usize>());
            let mut storage = vec![0usize; word_count];
            let mut actual_bytes = capacity as u32;
            returned = 0;
            // `storage` provides native alignment; its byte slice only exposes the
            // requested capacity, not padding at the end of the usize allocation.
            let buffer =
                unsafe { slice::from_raw_parts_mut(storage.as_mut_ptr().cast::<u8>(), capacity) };
            match unsafe {
                EnumPrintersW(
                    flags,
                    PCWSTR::null(),
                    2,
                    Some(buffer),
                    &mut actual_bytes,
                    &mut returned,
                )
            } {
                Ok(()) if actual_bytes as usize <= capacity => {
                    let entries = PrinterEntries {
                        storage,
                        byte_len: actual_bytes as usize,
                        returned: returned as usize,
                    };
                    entries.records()?;
                    return Ok(entries);
                }
                Ok(()) => {
                    capacity = actual_bytes as usize;
                }
                Err(_error) if actual_bytes as usize > capacity => {
                    capacity = actual_bytes as usize;
                }
                Err(error) => {
                    return Err(PrintError::Adapter(format!(
                        "EnumPrintersW failed: {error}"
                    )))
                }
            }
            if capacity == 0 {
                return Ok(PrinterEntries::empty());
            }
        }
        Err(PrintError::Adapter(
            "printer list changed repeatedly while EnumPrintersW resized its buffer".into(),
        ))
    }

    pub(super) fn list() -> Result<Vec<PrinterInfo>, PrintError> {
        let buffer = printer_entries()?;
        let entries = buffer.records()?;
        let mut result = Vec::with_capacity(entries.len());
        for entry in entries {
            let name = wide_ptr_to_string(buffer.bytes(), entry.pPrinterName)?;
            if name.is_empty() {
                continue;
            }
            result.push(PrinterInfo {
                id: name.clone(),
                name,
                is_default: entry.Attributes & PRINTER_ATTRIBUTE_DEFAULT != 0,
                is_available: printer_is_available(entry.Status, entry.Attributes),
            });
        }
        Ok(result)
    }

    fn wide_ptr_to_string(buffer: &[u8], pointer: PWSTR) -> Result<String, PrintError> {
        if pointer.is_null() {
            return Ok(String::new());
        }
        let base = buffer.as_ptr() as usize;
        let end = base
            .checked_add(buffer.len())
            .ok_or_else(|| PrintError::Adapter("printer buffer address overflowed".into()))?;
        let address = pointer.0 as usize;
        if address < base || address >= end || (address - base) % size_of::<u16>() != 0 {
            return Err(PrintError::Adapter(
                "EnumPrintersW returned a string pointer outside its buffer".into(),
            ));
        }
        native_utf16z(buffer, address - base)
    }

    /// Releases the printer device context on every exit path.
    struct DeviceContext(HDC, std::cell::Cell<bool>);
    impl DeviceContext {
        fn new(hdc: HDC) -> Self {
            Self(hdc, std::cell::Cell::new(false))
        }
    }
    impl Drop for DeviceContext {
        fn drop(&mut self) {
            // A document left open (for example by a panic) would stay in the spooler.
            if self.1.get() {
                unsafe {
                    let _ = AbortDoc(self.0);
                }
            }
            unsafe {
                let _ = DeleteDC(self.0);
            }
        }
    }

    fn create_font(size_pt: f32, bold: bool, y_dpi: i32) -> HFONT {
        let height = (size_pt * y_dpi as f32 / 72.0).round().max(1.0) as i32;
        let face: Vec<u16> = "Segoe UI".encode_utf16().chain([0]).collect();
        unsafe {
            CreateFontW(
                -height,
                0,
                0,
                0,
                if bold { FW_BOLD.0 as i32 } else { 400 },
                0,
                0,
                0,
                DEFAULT_CHARSET,
                OUT_DEFAULT_PRECIS,
                CLIP_DEFAULT_PRECIS,
                DEFAULT_QUALITY,
                DEFAULT_PITCH.0 as u32 | FF_DONTCARE.0 as u32,
                PCWSTR(face.as_ptr()),
            )
        }
    }

    /// Measures text with the printer's own font metrics so layout matches what is drawn.
    struct GdiMeter {
        hdc: HDC,
        x_dpi: i32,
        y_dpi: i32,
    }

    impl TextMeter for GdiMeter {
        fn width_pt(&self, text: &str, size_pt: f32, bold: bool) -> f32 {
            let font = create_font(size_pt, bold, self.y_dpi);
            let previous = unsafe { SelectObject(self.hdc, font.into()) };
            let wide: Vec<u16> = text.encode_utf16().collect();
            let mut size = SIZE { cx: 0, cy: 0 };
            let measured = unsafe { GetTextExtentPoint32W(self.hdc, &wide, &mut size) }.as_bool();
            unsafe {
                let _ = SelectObject(self.hdc, previous);
                let _ = DeleteObject(font.into());
            }
            if measured {
                size.cx as f32 * 72.0 / self.x_dpi as f32
            } else {
                // An unmeasurable line must not be treated as fitting.
                f32::MAX
            }
        }
    }

    struct PrinterHandle(PRINTER_HANDLE);
    impl Drop for PrinterHandle {
        fn drop(&mut self) {
            unsafe {
                let _ = ClosePrinter(self.0);
            }
        }
    }

    /// Read the driver's current settings, change only orientation and requested media, then let
    /// the driver validate the updated DEVMODE before a DC or spool job is created.
    fn configured_devmode(
        printer_name: &[u16],
        document: &PrintDocument,
    ) -> Result<Vec<usize>, PrintError> {
        let mut raw_handle = PRINTER_HANDLE::default();
        unsafe { OpenPrinterW(PCWSTR(printer_name.as_ptr()), &mut raw_handle, None) }.map_err(
            |error| {
                PrintError::PrinterUnavailable(format!("could not open printer settings: {error}"))
            },
        )?;
        let handle = PrinterHandle(raw_handle);
        let device_name = PCWSTR(printer_name.as_ptr());
        let bytes = unsafe { DocumentPropertiesW(None, handle.0, device_name, None, None, 0) };
        if bytes < size_of::<DEVMODEW>() as i32 {
            return Err(PrintError::Adapter(
                "the printer driver returned an invalid DEVMODE size".into(),
            ));
        }
        let words = (bytes as usize).div_ceil(size_of::<usize>());
        let mut defaults = vec![0usize; words];
        let defaults_ptr = defaults.as_mut_ptr().cast::<DEVMODEW>();
        let result = unsafe {
            DocumentPropertiesW(
                None,
                handle.0,
                device_name,
                Some(defaults_ptr),
                None,
                DM_OUT_BUFFER.0,
            )
        };
        if result <= 0 {
            return Err(PrintError::Adapter(
                "the printer driver could not return its current print settings".into(),
            ));
        }
        unsafe {
            let devmode = &mut *defaults_ptr;
            let fields = &mut devmode.Anonymous1.Anonymous1;
            devmode.dmFields |= DM_ORIENTATION;
            match document {
                PrintDocument::Bill(_) => {
                    fields.dmOrientation = DMORIENT_LANDSCAPE as i16;
                    fields.dmPaperSize = DMPAPER_A5 as i16;
                    devmode.dmFields |= DM_PAPERSIZE;
                }
                PrintDocument::Tags(tags) => {
                    let length =
                        i16::try_from(tag_strip_length_tenths_mm(tags)?).map_err(|_| {
                            PrintError::Invalid(
                                "tag cut length exceeds the Windows driver limit".into(),
                            )
                        })?;
                    fields.dmOrientation = DMORIENT_PORTRAIT as i16;
                    fields.dmPaperSize = DMPAPER_USER as i16;
                    fields.dmPaperWidth = 500; // 50 mm, in DEVMODE's 1/10 mm units.
                    fields.dmPaperLength = length;
                    devmode.dmFields |= DM_PAPERSIZE | DM_PAPERWIDTH | DM_PAPERLENGTH;
                }
            }
        }
        let mut configured = defaults.clone();
        let configured_ptr = configured.as_mut_ptr().cast::<DEVMODEW>();
        let result = unsafe {
            DocumentPropertiesW(
                None,
                handle.0,
                device_name,
                Some(configured_ptr),
                Some(defaults_ptr),
                DM_IN_BUFFER.0 | DM_OUT_BUFFER.0,
            )
        };
        if result <= 0 {
            return Err(PrintError::Adapter(
                "the printer driver refused the requested paper size or orientation".into(),
            ));
        }
        Ok(configured)
    }

    pub(super) fn submit(
        printer_name: &str,
        document: &PrintDocument,
    ) -> Result<SubmissionReceipt, PrintError> {
        let name: Vec<u16> = printer_name.encode_utf16().chain([0]).collect();
        let devmode = configured_devmode(&name, document)?;
        let devmode_ptr = devmode.as_ptr().cast::<DEVMODEW>();
        let hdc = unsafe {
            CreateDCW(
                PCWSTR::null(),
                PCWSTR(name.as_ptr()),
                PCWSTR::null(),
                Some(devmode_ptr),
            )
        };
        if hdc.0.is_null() {
            return Err(PrintError::PrinterUnavailable(format!(
                "could not create a printer device context for {printer_name}"
            )));
        }
        let context = DeviceContext::new(hdc);
        let (
            x_dpi,
            y_dpi,
            physical_width_px,
            physical_height_px,
            offset_x_px,
            offset_y_px,
            printable_width_px,
            printable_height_px,
        ) = unsafe {
            (
                GetDeviceCaps(Some(hdc), LOGPIXELSX),
                GetDeviceCaps(Some(hdc), LOGPIXELSY),
                GetDeviceCaps(Some(hdc), PHYSICALWIDTH),
                GetDeviceCaps(Some(hdc), PHYSICALHEIGHT),
                GetDeviceCaps(Some(hdc), PHYSICALOFFSETX),
                GetDeviceCaps(Some(hdc), PHYSICALOFFSETY),
                GetDeviceCaps(Some(hdc), HORZRES),
                GetDeviceCaps(Some(hdc), VERTRES),
            )
        };
        let geometry = PrinterPageGeometry::from_device_caps(
            physical_width_px,
            physical_height_px,
            offset_x_px,
            offset_y_px,
            printable_width_px,
            printable_height_px,
            x_dpi,
            y_dpi,
        )?;
        let geometry = match document {
            PrintDocument::Tags(tags) => geometry.validate_tag_media(tags)?,
            PrintDocument::Bill(_) => geometry.use_requested_bill_media(),
        };
        let spec = geometry.media;
        // Everything that can be wrong with the content is found here, before a spool job exists,
        // so such failures are certain (nothing printed) rather than "uncertain".
        let meter = GdiMeter {
            hdc: context.0,
            x_dpi,
            y_dpi,
        };
        let pages = layout_document(document, spec, &meter)?;
        geometry.validate_layout(&pages, &meter)?;
        // Resolve translations before StartDoc so a failed mapping cannot leave a partially
        // submitted job. Layout coordinates use the physical media origin; GDI uses the
        // printable-area origin reported by the driver.
        let mapped_pages: Vec<(Vec<(i32, i32, i32)>, Vec<(i32, i32)>)> = pages
            .iter()
            .map(|page| {
                let rules = page
                    .rules
                    .iter()
                    .map(|rule| {
                        let (x1, y) = geometry.media_point_to_device(rule.x1_pt, rule.y_pt)?;
                        let (x2, _) = geometry.media_point_to_device(rule.x2_pt, rule.y_pt)?;
                        Ok((x1, x2, y))
                    })
                    .collect::<Result<_, PrintError>>()?;
                let lines = page
                    .lines
                    .iter()
                    .map(|line| geometry.media_point_to_device(line.x_pt, line.y_pt))
                    .collect::<Result<_, PrintError>>()?;
                Ok((rules, lines))
            })
            .collect::<Result<_, PrintError>>()?;

        let doc_name: Vec<u16> = match document {
            PrintDocument::Bill(b) => format!("Laundry bill {}", safe_text(&b.order_number)),
            PrintDocument::Tags(t) => format!("Laundry tags {}", safe_text(&t.order_number)),
        }
        .encode_utf16()
        .chain([0])
        .collect();
        let info = DOCINFOW {
            cbSize: size_of::<DOCINFOW>() as i32,
            lpszDocName: PCWSTR(doc_name.as_ptr()),
            lpszOutput: PCWSTR::null(),
            lpszDatatype: PCWSTR::null(),
            fwType: 0,
        };
        let job_id = unsafe { StartDocW(context.0, &info) };
        if job_id <= 0 {
            return Err(PrintError::Adapter(
                "Windows spooler rejected StartDoc".into(),
            ));
        }
        context.1.set(true);
        // `may_have_printed` is true when the failing step could already have put a page on the
        // printer (finishing a page); a failure before any page was finished is certain.
        let stop = |pages_done: usize, reason: &str, may_have_printed: bool| {
            unsafe {
                let _ = AbortDoc(context.0);
            }
            context.1.set(false);
            if pages_done == 0 && !may_have_printed {
                // Nothing reached the printer: the job was removed, so a retry is safe.
                Err(PrintError::Adapter(reason.to_owned()))
            } else {
                Ok(SubmissionReceipt {
                    os_job_id: Some(job_id.to_string()),
                    accepted_at: now_rfc3339(),
                    certainty: SubmissionCertainty::Uncertain,
                    detail: Some(format!(
                        "{reason} after {pages_done} of {} pages were sent",
                        pages.len()
                    )),
                })
            }
        };
        for (done, (page, (rule_positions, line_positions))) in
            pages.iter().zip(mapped_pages.iter()).enumerate()
        {
            if unsafe { StartPage(context.0) } <= 0 {
                return stop(done, "Windows could not start a page", false);
            }
            for (x1, x2, y) in rule_positions {
                let moved = unsafe { MoveToEx(context.0, *x1, *y, None) }.as_bool();
                let drawn = unsafe { LineTo(context.0, *x2, *y) }.as_bool();
                if !moved || !drawn {
                    return stop(done, "Windows could not draw a bill rule", false);
                }
            }
            for (line, (x, y)) in page.lines.iter().zip(line_positions) {
                let font = create_font(line.size_pt, line.bold, y_dpi);
                let previous = unsafe { SelectObject(context.0, font.into()) };
                let wide: Vec<u16> = line.text.encode_utf16().collect();
                let drawn = unsafe { TextOutW(context.0, *x, *y, &wide) }.as_bool();
                unsafe {
                    let _ = SelectObject(context.0, previous);
                    let _ = DeleteObject(font.into());
                }
                if !drawn {
                    return stop(done, "Windows could not draw a line of text", false);
                }
            }
            if unsafe { EndPage(context.0) } <= 0 {
                return stop(done, "Windows could not finish a page", true);
            }
        }
        context.1.set(false);
        if unsafe { EndDoc(context.0) } <= 0 {
            return Ok(SubmissionReceipt {
                os_job_id: Some(job_id.to_string()),
                accepted_at: now_rfc3339(),
                certainty: SubmissionCertainty::Uncertain,
                detail: Some(
                    "Windows spooler status was lost after document submission".to_owned(),
                ),
            });
        }
        Ok(SubmissionReceipt {
            os_job_id: Some(job_id.to_string()),
            accepted_at: now_rfc3339(),
            certainty: SubmissionCertainty::Accepted,
            detail: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::print_layout::{layout_document, LaidOutPage, TextMeter};

    struct TestMeter;
    impl TextMeter for TestMeter {
        fn width_pt(&self, text: &str, size_pt: f32, _bold: bool) -> f32 {
            text.chars().count() as f32 * size_pt * 0.5
        }
    }

    fn tags() -> PrintDocument {
        PrintDocument::Tags(TagDocument {
            order_number: "SL-103".into(),
            pieces: vec![TagPiece {
                piece_id: "piece-001".into(),
                garment: "Kurta".into(),
                service: "Wash + Iron".into(),
                position: 1,
                total: 1,
            }],
            ..TagDocument::default()
        })
    }
    fn bill() -> PrintDocument {
        PrintDocument::Bill(BillDocument {
            header: BillHeader::default(),
            order_number: "SL-103".into(),
            created_at_ist: "15 Oct 2026 10:30 IST".into(),
            promised_at_ist: "17 Oct 2026 17:00 IST".into(),
            customer_name: "Test Customer".into(),
            customer_phone: "TEST-PHONE".into(),
            items: vec![BillItem {
                garment: "Kurta".into(),
                service: "Wash + Iron".into(),
                quantity: 1,
                unit_price_minor: 4500,
                line_total_minor: 4500,
            }],
            subtotal_minor: 4500,
            discount_percent_bp: 0,
            discount_minor: 0,
            paid_minor: 1000,
            balance_minor: 3500,
            physical_piece_count: 1,
        })
    }

    #[test]
    fn physical_media_geometry_translates_into_nonzero_printable_offsets() {
        // 300 DPI caps for a 50 x 100 mm custom strip. The physical edge has a 12 px left
        // and 18 px top offset before the 550 x 1140 px printable rectangle begins.
        let document = PrintDocument::Tags(TagDocument {
            order_number: "SL-105".into(),
            pieces: (1..=3)
                .map(|position| TagPiece {
                    piece_id: format!("piece-{position:03}"),
                    garment: "Shirt".into(),
                    service: "Wash + Iron".into(),
                    position,
                    total: 3,
                })
                .collect(),
            tag_length_tenths_mm: 300,
            ..TagDocument::default()
        });
        let PrintDocument::Tags(tags) = &document else {
            unreachable!()
        };
        let geometry =
            PrinterPageGeometry::from_device_caps(591, 1181, 12, 18, 550, 1140, 300, 300)
                .unwrap()
                .validate_tag_media(tags)
                .unwrap();
        assert!((geometry.media.width_pt - 50.0 * 72.0 / 25.4).abs() < 0.01);
        assert!((geometry.media.height_pt - 100.0 * 72.0 / 25.4).abs() < 0.01);
        let pages = layout_document(&document, geometry.media, &TestMeter).unwrap();
        geometry.validate_layout(&pages, &TestMeter).unwrap();

        let first_line = pages[0]
            .lines
            .iter()
            .find(|line| line.text.starts_with("Bill "))
            .unwrap();
        // Layout is 10 mm from the physical left edge. GDI coordinates are relative to the
        // printable area's left edge, so add back PHYSICALOFFSETX to recover the media position.
        let (device_x, device_y) = geometry
            .media_point_to_device(first_line.x_pt, first_line.y_pt)
            .unwrap();
        let physical_x_px = device_x + 12;
        let physical_y_px = device_y + 18;
        assert!((physical_x_px as f32 * 25.4 / 300.0 - 10.0).abs() < 0.05);
        assert!(physical_y_px >= 18);
        assert!(device_x >= 0 && device_y >= 0);
        assert!(pages.iter().all(|page: &LaidOutPage| page
            .lines
            .iter()
            .all(|line| { geometry.media_point_to_device(line.x_pt, line.y_pt).is_ok() })));

        let bill_geometry =
            PrinterPageGeometry::from_device_caps(2480, 1748, 15, 20, 2450, 1700, 300, 300)
                .unwrap()
                .use_requested_bill_media();
        assert!((bill_geometry.media.width_pt - 210.0 * 72.0 / 25.4).abs() < 0.01);
        assert!((bill_geometry.media.height_pt - 148.0 * 72.0 / 25.4).abs() < 0.01);
        let pages = layout_document(&bill(), bill_geometry.media, &TestMeter).unwrap();
        bill_geometry.validate_layout(&pages, &TestMeter).unwrap();
    }

    #[test]
    fn physical_media_geometry_rejects_printable_rectangles_outside_the_page() {
        assert!(matches!(
            PrinterPageGeometry::from_device_caps(591, 1181, 12, 18, 580, 1140, 300, 300),
            Err(PrintError::Adapter(message)) if message.contains("inconsistent")
        ));

        let tags = TagDocument {
            order_number: "SL-106".into(),
            pieces: vec![TagPiece {
                piece_id: "piece-001".into(),
                garment: "Shirt".into(),
                service: "Wash".into(),
                position: 1,
                total: 1,
            }],
            tag_length_tenths_mm: 300,
            ..TagDocument::default()
        };
        let reported_width_mismatch =
            PrinterPageGeometry::from_device_caps(600, 472, 12, 18, 550, 430, 300, 300).unwrap();
        assert!(matches!(
            reported_width_mismatch.validate_tag_media(&tags),
            Err(PrintError::Adapter(message)) if message.contains("50 mm tag strip dimensions")
        ));
    }

    #[test]
    fn tags_have_piece_identity_and_no_customer_or_due_fields() {
        let lines = render_lines(&tags()).concat();
        let text = lines.join(" ");
        assert!(text.contains("SL-103") && text.contains("piece-001") && text.contains("1/1"));
        assert!(!text.to_lowercase().contains("customer"));
        assert!(!text.to_lowercase().contains("17 oct"));
    }
    #[test]
    fn bill_includes_promise_payment_and_count() {
        let text = render_lines(&bill()).concat().join(" ");
        for expected in [
            "17 Oct 2026 17:00 IST",
            "₹45.00",
            "₹10.00",
            "₹35.00",
            "Pieces: 1",
        ] {
            assert!(text.contains(expected), "missing {expected}");
        }
    }
    fn bill_with_header(header: BillHeader) -> BillDocument {
        let PrintDocument::Bill(mut value) = bill() else {
            unreachable!()
        };
        value.header = header;
        value
    }
    #[test]
    fn bill_header_and_footer_come_from_the_saved_document() {
        let document = PrintDocument::Bill(bill_with_header(BillHeader {
            shop_name: "Example  Cleaners".into(),
            address: "12 Example Road".into(),
            phone: "PHONE TEST VALUE".into(),
            footer: "Visit again".into(),
            ..BillHeader::default()
        }));
        validate_document(&document).unwrap();
        let lines = render_lines(&document).concat();
        assert_eq!(lines[0], "Example Cleaners");
        assert_eq!(lines[1], "12 Example Road");
        assert_eq!(lines[2], "Tel: PHONE TEST VALUE");
        assert_eq!(lines.last().unwrap(), "Visit again");
        assert!(!lines.iter().any(|l| l == "Thank you"));
    }
    #[test]
    fn bill_without_a_saved_header_keeps_the_original_text() {
        let lines = render_lines(&bill()).concat();
        assert_eq!(lines[0], "SMART LAUNDRY");
        assert!(lines[1].starts_with("Bill: "));
        assert_eq!(lines.last().unwrap(), "Thank you");
    }
    #[test]
    fn bills_saved_before_shop_settings_still_load() {
        let mut json = serde_json::to_value(bill()).unwrap();
        json["document"].as_object_mut().unwrap().remove("header");
        let parsed: PrintDocument = serde_json::from_value(json).unwrap();
        let PrintDocument::Bill(parsed) = parsed else {
            unreachable!()
        };
        assert_eq!(parsed.header, BillHeader::default());
        let partial: BillHeader = serde_json::from_str(r#"{"shopName":"Only Name"}"#).unwrap();
        assert_eq!(partial.shop_name, "Only Name");
        assert!(partial.footer.is_empty());
        assert!(partial.show_customer_phone && partial.show_received_at && partial.show_ready_by);
        let old_tags: TagDocument =
            serde_json::from_str(r#"{"orderNumber":"SL-1","pieces":[]}"#).unwrap();
        assert_eq!(old_tags.tag_length_tenths_mm, 1016);
        assert!(!old_tags.show_shop_name);
        assert!(
            serde_json::to_value(old_tags).unwrap()["tagLengthMm"]
                .as_f64()
                .unwrap()
                == 101.6
        );
    }
    #[test]
    fn oversized_header_text_is_rejected() {
        for field in 0..5 {
            let mut header = BillHeader::default();
            let long = "x".repeat(if field == 3 {
                MAX_HEADER_FIELD_CHARS * 3 + 1
            } else {
                MAX_HEADER_FIELD_CHARS + 1
            });
            match field {
                0 => header.shop_name = long,
                1 => header.address = long,
                2 => header.phone = long,
                3 => header.footer = long,
                _ => header.message = long,
            }
            assert!(validate_document(&PrintDocument::Bill(bill_with_header(header))).is_err());
        }
        let at_limit = BillHeader {
            shop_name: "x".repeat(MAX_HEADER_FIELD_CHARS),
            ..BillHeader::default()
        };
        validate_document(&PrintDocument::Bill(bill_with_header(at_limit))).unwrap();
    }
    #[test]
    fn invalid_tag_position_rejected() {
        let PrintDocument::Tags(mut value) = tags() else {
            unreachable!()
        };
        value.pieces[0].position = 2;
        assert!(validate_document(&PrintDocument::Tags(value)).is_err());
    }

    #[test]
    fn tag_length_outside_supported_range_is_refused_before_printing() {
        let PrintDocument::Tags(mut value) = tags() else {
            unreachable!()
        };
        value.tag_length_tenths_mm = 299;
        assert!(matches!(
            validate_document(&PrintDocument::Tags(value)),
            Err(PrintError::Invalid(message)) if message.contains("cut length")
        ));
    }

    #[test]
    fn selected_tag_subset_preserves_original_order_positions_and_total() {
        let document = PrintDocument::Tags(TagDocument {
            order_number: "SL-104".into(),
            pieces: vec![
                TagPiece {
                    piece_id: "piece-003".into(),
                    garment: "Trousers".into(),
                    service: "Wash".into(),
                    position: 3,
                    total: 4,
                },
                TagPiece {
                    piece_id: "piece-001".into(),
                    garment: "Shirt".into(),
                    service: "Wash".into(),
                    position: 1,
                    total: 4,
                },
            ],
            ..TagDocument::default()
        });
        validate_document(&document).unwrap();
        let rendered = render_lines(&document).concat().join(" ");
        assert!(rendered.contains("piece-003 (3/4)"));
        assert!(rendered.contains("piece-001 (1/4)"));

        let single_piece = PrintDocument::Tags(TagDocument {
            order_number: "SL-104".into(),
            pieces: vec![TagPiece {
                piece_id: "piece-003".into(),
                garment: "Trousers".into(),
                service: "Wash".into(),
                position: 3,
                total: 4,
            }],
            ..TagDocument::default()
        });
        validate_document(&single_piece).unwrap();
        assert!(render_lines(&single_piece)
            .concat()
            .join(" ")
            .contains("piece-003 (3/4)"));

        let first_and_fourth = PrintDocument::Tags(TagDocument {
            order_number: "SL-104".into(),
            pieces: vec![
                TagPiece {
                    piece_id: "piece-001".into(),
                    garment: "Shirt".into(),
                    service: "Wash".into(),
                    position: 1,
                    total: 4,
                },
                TagPiece {
                    piece_id: "piece-004".into(),
                    garment: "Trousers".into(),
                    service: "Wash".into(),
                    position: 4,
                    total: 4,
                },
            ],
            ..TagDocument::default()
        });
        validate_document(&first_and_fourth).unwrap();
        let rendered = render_lines(&first_and_fourth).concat().join(" ");
        assert!(rendered.contains("piece-001 (1/4)"));
        assert!(rendered.contains("piece-004 (4/4)"));
    }

    #[test]
    fn selected_tag_subset_rejects_duplicate_or_out_of_range_positions() {
        let duplicate_positions = PrintDocument::Tags(TagDocument {
            order_number: "SL-104".into(),
            pieces: vec![
                TagPiece {
                    piece_id: "piece-003".into(),
                    garment: "Trousers".into(),
                    service: "Wash".into(),
                    position: 3,
                    total: 4,
                },
                TagPiece {
                    piece_id: "piece-003-other".into(),
                    garment: "Shirt".into(),
                    service: "Wash".into(),
                    position: 3,
                    total: 4,
                },
            ],
            ..TagDocument::default()
        });
        assert!(validate_document(&duplicate_positions).is_err());

        let duplicate_ids = PrintDocument::Tags(TagDocument {
            order_number: "SL-104".into(),
            pieces: vec![
                TagPiece {
                    piece_id: "piece-003".into(),
                    garment: "Trousers".into(),
                    service: "Wash".into(),
                    position: 3,
                    total: 4,
                },
                TagPiece {
                    piece_id: "piece-003".into(),
                    garment: "Shirt".into(),
                    service: "Wash".into(),
                    position: 4,
                    total: 4,
                },
            ],
            ..TagDocument::default()
        });
        assert!(validate_document(&duplicate_ids).is_err());

        let out_of_range = PrintDocument::Tags(TagDocument {
            order_number: "SL-104".into(),
            pieces: vec![TagPiece {
                piece_id: "piece-005".into(),
                garment: "Trousers".into(),
                service: "Wash".into(),
                position: 5,
                total: 4,
            }],
            ..TagDocument::default()
        });
        assert!(validate_document(&out_of_range).is_err());
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn linux_cups_requests_landscape_a5_and_the_configured_continuous_roll_length() {
        let args = linux_adapter::lp_arguments("Canon; $(no-shell)", &bill()).unwrap();
        assert!(args
            .windows(2)
            .any(|part| part == ["-d", "Canon; $(no-shell)"]));
        assert!(args.contains(&"media=A5".into()));
        assert!(args.contains(&"orientation-requested=4".into()));
        assert!(!args.contains(&"fit-to-page".into()));

        let mut tag_document = tags();
        let PrintDocument::Tags(tags) = &mut tag_document else {
            unreachable!()
        };
        tags.tag_length_tenths_mm = 1250;
        let tags_args = linux_adapter::lp_arguments("TSC-TE244", &tag_document).unwrap();
        assert!(tags_args.contains(&"media=Custom.50x135.0mm".into()));
        assert!(tags_args.contains(&"orientation-requested=3".into()));
        assert!(!tags_args.contains(&"fit-to-page".into()));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_renderer_builds_a_structured_multi_page_pdf() {
        let mut document = bill();
        let PrintDocument::Bill(bill) = &mut document else {
            unreachable!()
        };
        bill.items = (0..40)
            .map(|index| BillItem {
                garment: format!("Garment {index}"),
                service: "Wash + Iron".into(),
                quantity: 2,
                unit_price_minor: 2500,
                line_total_minor: 5000,
            })
            .collect();
        bill.subtotal_minor = 200_000;
        bill.physical_piece_count = 80;
        bill.paid_minor = 200_000;
        bill.balance_minor = 0;
        let pdf = linux_adapter::render_pdf(&document).unwrap();
        assert!(pdf.starts_with(b"%PDF-"));
        assert!(pdf.len() > 1_000);

        let tags_pdf = linux_adapter::render_pdf(&tags()).unwrap();
        assert!(tags_pdf.starts_with(b"%PDF-"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_cups_job_identifier_parser_requires_a_job_id() {
        assert_eq!(
            linux_adapter::cups_job_id("request id is TE244-83 (1 file(s))"),
            Some("TE244-83".into())
        );
        assert_eq!(linux_adapter::cups_job_id(""), None);
    }

    #[test]
    fn control_characters_cannot_create_extra_lines_or_printer_controls() {
        let text = format!(
            "Asha{}[2J{}Patil",
            char::from_u32(0x1b).unwrap(),
            char::from_u32(0x0a).unwrap()
        );
        assert_eq!(safe_text(&text), "Asha [2J Patil");
    }

    #[test]
    fn deadline_returns_the_result_of_fast_work() {
        let result = run_with_deadline(Duration::from_secs(5), || Ok(7));
        assert_eq!(result.unwrap(), 7);
        let failure: Result<u8, _> = run_with_deadline(Duration::from_secs(5), || {
            Err(PrintError::Invalid("bad".into()))
        });
        assert!(matches!(failure, Err(PrintError::Invalid(_))));
    }

    #[test]
    fn deadline_reports_hung_or_crashed_work_as_uncertain() {
        let hung: Result<u8, _> = run_with_deadline(Duration::from_millis(30), || {
            std::thread::sleep(Duration::from_millis(600));
            Ok(1)
        });
        assert!(matches!(hung, Err(PrintError::Uncertain(m)) if m.contains("did not answer")));
        let crashed: Result<u8, _> =
            run_with_deadline(Duration::from_secs(5), || panic!("adapter bug"));
        assert!(matches!(crashed, Err(PrintError::Uncertain(m)) if m.contains("stopped")));
    }

    #[test]
    fn bills_with_inconsistent_money_are_rejected_before_printing() {
        let PrintDocument::Bill(good) = bill() else {
            unreachable!()
        };
        let mut wrong_sum = good.clone();
        wrong_sum.subtotal_minor = 4600;
        assert!(validate_document(&PrintDocument::Bill(wrong_sum)).is_err());
        let mut wrong_line = good.clone();
        wrong_line.items[0].line_total_minor = 4400;
        wrong_line.subtotal_minor = 4400;
        assert!(validate_document(&PrintDocument::Bill(wrong_line)).is_err());
        let mut wrong_paid = good.clone();
        wrong_paid.paid_minor = 100;
        assert!(validate_document(&PrintDocument::Bill(wrong_paid)).is_err());
        let mut big_discount = good.clone();
        big_discount.discount_minor = 5000;
        assert!(validate_document(&PrintDocument::Bill(big_discount)).is_err());
        let mut bad_percent = good.clone();
        bad_percent.discount_percent_bp = 10_001;
        assert!(validate_document(&PrintDocument::Bill(bad_percent)).is_err());
        let mut negative = good.clone();
        negative.discount_minor = -1;
        assert!(validate_document(&PrintDocument::Bill(negative)).is_err());
        let mut discounted = good;
        discounted.discount_percent_bp = 1000;
        discounted.discount_minor = 450;
        discounted.paid_minor = 4050;
        discounted.balance_minor = 0;
        validate_document(&PrintDocument::Bill(discounted)).unwrap();
    }

    #[test]
    fn documents_saved_before_discounts_still_load() {
        let mut value = serde_json::to_value(bill()).unwrap();
        let inner = value["document"].as_object_mut().unwrap();
        inner.remove("discountPercentBp");
        inner.remove("discountMinor");
        let loaded: PrintDocument = serde_json::from_value(value).unwrap();
        let PrintDocument::Bill(loaded) = loaded else {
            unreachable!()
        };
        assert_eq!((loaded.discount_percent_bp, loaded.discount_minor), (0, 0));
    }

    #[test]
    fn a_printer_that_is_busy_printing_still_counts_as_available() {
        const PRINTING: u32 = 0x400;
        const BUSY: u32 = 0x200;
        const WAITING: u32 = 0x2000;
        const TONER_LOW: u32 = 0x20000;
        assert!(printer_is_available(0, 0));
        for harmless in [PRINTING, BUSY, WAITING, TONER_LOW, PRINTING | BUSY] {
            assert!(printer_is_available(harmless, 0), "status {harmless:#x}");
        }
    }

    #[test]
    fn printers_that_cannot_print_right_now_are_unavailable() {
        for (name, status) in [
            ("paused", 0x1),
            ("error", 0x2),
            ("pending deletion", 0x4),
            ("paper jam", 0x8),
            ("paper out", 0x10),
            ("paper problem", 0x40),
            ("offline", 0x80),
            ("not available", 0x1000),
            ("user intervention", 0x10_0000),
            ("door open", 0x40_0000),
            ("printing but jammed", 0x400 | 0x8),
        ] {
            assert!(!printer_is_available(status, 0), "{name}");
        }
        assert!(
            !printer_is_available(0, PRINTER_ATTRIBUTE_WORK_OFFLINE),
            "'Use Printer Offline' accepts jobs and never prints them"
        );
        assert!(printer_is_available(0, PRINTER_ATTRIBUTE_DEFAULT));
    }

    #[test]
    fn only_one_submission_can_talk_to_a_printer_at_a_time() {
        let first = PrinterSlot::claim("Slot Test TSC").unwrap();
        let blocked = PrinterSlot::claim("Slot Test TSC").err().unwrap();
        assert!(
            matches!(&blocked, PrintError::PrinterUnavailable(m) if m.contains("still running")),
            "{blocked}"
        );
        assert!(
            PrinterSlot::claim("Slot Test Canon").is_ok(),
            "other printers are unaffected"
        );
        drop(first);
        assert!(
            PrinterSlot::claim("Slot Test TSC").is_ok(),
            "released when the worker ends"
        );
    }

    #[test]
    fn large_tag_batches_get_more_time_but_never_more_than_the_cap() {
        assert_eq!(deadline_for(&bill()), SUBMIT_DEADLINE);
        let tags_of = |count: u32| {
            PrintDocument::Tags(TagDocument {
                order_number: "SL-1".into(),
                pieces: (1..=count)
                    .map(|n| TagPiece {
                        piece_id: format!("p{n}"),
                        garment: "Shirt".into(),
                        service: "Wash".into(),
                        position: n,
                        total: count,
                    })
                    .collect(),
                ..TagDocument::default()
            })
        };
        assert_eq!(
            deadline_for(&tags_of(1)),
            SUBMIT_DEADLINE + EXTRA_DEADLINE_PER_TAG
        );
        assert_eq!(
            deadline_for(&tags_of(50)),
            SUBMIT_DEADLINE + EXTRA_DEADLINE_PER_TAG * 50
        );
        assert!(deadline_for(&tags_of(MAX_TAGS_PER_DOCUMENT as u32)) <= MAX_DEADLINE);
        assert!(validate_document(&tags_of(MAX_TAGS_PER_DOCUMENT as u32)).is_err());
        assert!(validate_document(&tags_of(MAX_TAGS_PER_DOCUMENT as u32 + 1)).is_err());
    }

    #[test]
    fn accepted_timestamp_is_utc_rfc3339() {
        let timestamp = now_rfc3339();
        assert_eq!(timestamp.len(), 20);
        assert!(timestamp.ends_with('Z'));
        assert_eq!(timestamp.as_bytes()[4], b'-');
        assert_eq!(timestamp.as_bytes()[10], b'T');
    }

    #[test]
    fn request_serde_uses_camel_case_document_contract() {
        let json = serde_json::to_value(SubmitDocumentRequest {
            printer_id: "Canon LBP".into(),
            document: bill(),
        })
        .unwrap();
        assert_eq!(json["printerId"], "Canon LBP");
        assert_eq!(
            json["document"]["document"]["promisedAtIst"],
            "17 Oct 2026 17:00 IST"
        );
    }
}

#[cfg(test)]
mod native_buffer_tests {
    use super::*;
    use std::mem::size_of;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct MockNativeRecord {
        marker: usize,
    }

    #[test]
    fn native_buffer_uses_returned_count_and_ignores_trailing_strings() {
        let record_bytes = size_of::<MockNativeRecord>();
        let buffer_bytes = record_bytes + 32;
        let word_count = buffer_bytes.div_ceil(size_of::<usize>());
        let mut storage = vec![0usize; word_count];
        let bytes = unsafe {
            std::slice::from_raw_parts_mut(storage.as_mut_ptr().cast::<u8>(), buffer_bytes)
        };
        unsafe {
            bytes
                .as_mut_ptr()
                .cast::<MockNativeRecord>()
                .write(MockNativeRecord { marker: 0xfeed });
        }
        bytes[record_bytes..].fill(0x41);

        let records = unsafe { native_record_prefix::<MockNativeRecord>(bytes, 1) }.unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].marker, 0xfeed);
        assert!(
            unsafe { native_record_prefix::<MockNativeRecord>(bytes, 0) }
                .unwrap()
                .is_empty()
        );
        assert!(unsafe { native_record_prefix::<MockNativeRecord>(&bytes[1..], 1) }.is_err());
        assert!(unsafe { native_record_prefix::<MockNativeRecord>(bytes, 6) }.is_err());
    }

    #[test]
    fn native_utf16_strings_are_terminated_and_bounded_by_live_buffer() {
        let utf16 = [b'A', 0, b'B', 0, 0, 0];
        assert_eq!(native_utf16z(&utf16, 0).unwrap(), "AB");
        assert!(native_utf16z(&utf16[..4], 0).is_err());
        assert!(native_utf16z(&utf16, utf16.len()).is_err());
        assert!(native_utf16z(&utf16, 1).is_err());
    }
}
