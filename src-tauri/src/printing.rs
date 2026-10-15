//! Native printer queue discovery and document submission.
//!
//! Printer identifiers are operating-system queue names. They are never used to
//! change the user's default printer. The renderer submits structured documents;
//! customer text is drawn as text and is never interpreted as printer commands.

use serde::{Deserialize, Serialize};
use std::fmt;
#[cfg(any(target_os = "windows", test))]
use std::mem::{align_of, size_of};

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BillDocument {
    pub order_number: String,
    pub created_at_ist: String,
    pub promised_at_ist: String,
    pub customer_name: String,
    pub customer_phone: String,
    pub items: Vec<BillItem>,
    pub subtotal_minor: i64,
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
}

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

pub async fn submit_document(
    request: SubmitDocumentRequest,
) -> Result<SubmissionReceipt, PrintError> {
    validate_document(&request.document)?;
    let printers = enumerate_platform_printers()?;
    let printer = printers
        .iter()
        .find(|printer| printer.id == request.printer_id)
        .ok_or_else(|| PrintError::PrinterUnavailable(request.printer_id.clone()))?;
    if !printer.is_available {
        return Err(PrintError::PrinterUnavailable(request.printer_id));
    }

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
            "Native printing is not implemented for this operating system".into(),
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
            Ok(())
        }
        PrintDocument::Tags(tags) => {
            nonempty(&tags.order_number, "order number")?;
            if tags.pieces.is_empty() || tags.pieces.len() > u32::MAX as usize {
                return Err(PrintError::Invalid(
                    "tag document must contain physical pieces".into(),
                ));
            }
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

fn render_lines(document: &PrintDocument) -> Vec<Vec<String>> {
    match document {
        PrintDocument::Bill(bill) => {
            let mut lines = vec![vec![
                "SMART LAUNDRY".into(),
                format!("Bill: {}", safe_line(&bill.order_number)),
                format!("Date: {}", safe_line(&bill.created_at_ist)),
                format!("Customer: {}", safe_line(&bill.customer_name)),
                format!("Phone: {}", safe_line(&bill.customer_phone)),
                "----------------------------------------".into(),
            ]];
            for item in &bill.items {
                lines[0].push(format!(
                    "{} / {}  x{}",
                    safe_line(&item.garment),
                    safe_line(&item.service),
                    item.quantity
                ));
                lines[0].push(format!(
                    "  {}  {}",
                    money(item.unit_price_minor),
                    money(item.line_total_minor)
                ));
            }
            lines[0].extend([
                "----------------------------------------".into(),
                format!("Pieces: {}", bill.physical_piece_count),
                format!("Subtotal: {}", money(bill.subtotal_minor)),
                format!("Paid: {}", money(bill.paid_minor)),
                format!("Balance: {}", money(bill.balance_minor)),
                format!("Ready by: {}", safe_line(&bill.promised_at_ist)),
                "Thank you".into(),
            ]);
            lines
        }
        PrintDocument::Tags(tags) => tags
            .pieces
            .iter()
            .map(|piece| {
                vec![
                    format!("Bill {}", safe_line(&tags.order_number)),
                    format!(
                        "{} / {}",
                        safe_line(&piece.garment),
                        safe_line(&piece.service)
                    ),
                    format!(
                        "Piece {} ({}/{})",
                        safe_line(&piece.piece_id),
                        piece.position,
                        piece.total
                    ),
                ]
            })
            .collect(),
    }
}

fn safe_line(value: &str) -> String {
    value
        .chars()
        .map(|ch| if ch.is_control() { ' ' } else { ch })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn money(minor: i64) -> String {
    let sign = if minor < 0 { "-" } else { "" };
    let value = minor.unsigned_abs();
    format!("{sign}₹{}.{:02}", value / 100, value % 100)
}

#[cfg(target_os = "linux")]
mod linux_adapter {
    use super::*;
    use std::io::Write;
    use std::process::{Command, Stdio};

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

    pub(super) fn lp_arguments(printer_id: &str, is_tag: bool) -> Vec<String> {
        let media = if is_tag {
            "media=Custom.50x50mm"
        } else {
            "media=A4"
        };
        vec![
            "-d".into(),
            printer_id.into(),
            "-o".into(),
            "sides=one-sided".into(),
            "-o".into(),
            media.into(),
            "-o".into(),
            "fit-to-page".into(),
            "--".into(),
            "-".into(),
        ]
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
        let tag = matches!(document, PrintDocument::Tags(_));
        let mut command = Command::new("lp");
        command
            .args(lp_arguments(printer_id, tag))
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
        let body = render_lines(document)
            .iter()
            .map(|page| page.join("\n"))
            .collect::<Vec<_>>()
            .join("\x0c");
        if let Err(error) = input.write_all(body.as_bytes()) {
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

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
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
    use std::mem::size_of;
    use std::slice;
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::RECT;
    use windows::Win32::Graphics::Gdi::{
        CreateDCW, CreateFontW, DeleteDC, DeleteObject, DrawTextW, GetDeviceCaps, SelectObject,
        CLIP_DEFAULT_PRECIS, DEFAULT_CHARSET, DEFAULT_PITCH, DEFAULT_QUALITY, DT_NOPREFIX,
        DT_WORDBREAK, FF_DONTCARE, FW_BOLD, HORZRES, LOGPIXELSX, LOGPIXELSY, OUT_DEFAULT_PRECIS,
        VERTRES,
    };
    use windows::Win32::Graphics::Printing::{
        EnumPrintersW, PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL, PRINTER_INFO_2W,
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
            let status = entry.Status;
            let unavailable_bits = 0x0000_0002
                | 0x0000_0008
                | 0x0000_0010
                | 0x0000_0040
                | 0x0000_0080
                | 0x0000_0400
                | 0x0000_1000
                | 0x0010_0000;
            result.push(PrinterInfo {
                id: name.clone(),
                name,
                is_default: entry.Attributes & 0x0000_0004 != 0,
                is_available: status & unavailable_bits == 0,
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

    pub(super) fn submit(
        printer_name: &str,
        document: &PrintDocument,
    ) -> Result<SubmissionReceipt, PrintError> {
        let name: Vec<u16> = printer_name.encode_utf16().chain([0]).collect();
        let hdc = unsafe { CreateDCW(PCWSTR::null(), PCWSTR(name.as_ptr()), PCWSTR::null(), None) };
        if hdc.0.is_null() {
            return Err(PrintError::PrinterUnavailable(format!(
                "could not create a printer device context for {printer_name}"
            )));
        }
        let lines = render_lines(document);
        let is_tag = matches!(document, PrintDocument::Tags(_));
        let (x_dpi, y_dpi) = unsafe {
            (
                GetDeviceCaps(Some(hdc), LOGPIXELSX),
                GetDeviceCaps(Some(hdc), LOGPIXELSY),
            )
        };
        let left = ((x_dpi.max(1) * 3) / 10).max(1);
        let top = ((y_dpi.max(1) * 3) / 10).max(1);
        let base_line_height = ((y_dpi.max(1) * if is_tag { 4 } else { 5 }) / 10).max(1);
        let doc_name: Vec<u16> = match document {
            PrintDocument::Bill(b) => format!("Laundry bill {}", safe_line(&b.order_number)),
            PrintDocument::Tags(t) => format!("Laundry tags {}", safe_line(&t.order_number)),
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
        let job_id = unsafe { StartDocW(hdc, &info) };
        if job_id <= 0 {
            unsafe {
                let _ = DeleteDC(hdc);
            }
            return Err(PrintError::Adapter(
                "Windows spooler rejected StartDoc".into(),
            ));
        }
        let page_height = unsafe { GetDeviceCaps(Some(hdc), VERTRES) };
        let page_width = unsafe { GetDeviceCaps(Some(hdc), HORZRES) };
        let right = (page_width - left).max(left + 1);
        let mut uncertain = None;
        for page in &lines {
            if unsafe { StartPage(hdc) } <= 0 {
                uncertain = Some("Windows spooler failed after accepting the document".to_owned());
                break;
            }
            let mut y = top;
            for (index, line) in page.iter().enumerate() {
                let font_height = if index == 0 {
                    base_line_height * 2
                } else {
                    base_line_height
                };
                let face: Vec<u16> = "Segoe UI".encode_utf16().chain([0]).collect();
                let font = unsafe {
                    CreateFontW(
                        -font_height,
                        0,
                        0,
                        0,
                        if index == 0 { FW_BOLD.0 as i32 } else { 400 },
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
                };
                let old = unsafe { SelectObject(hdc, font.into()) };
                let mut text: Vec<u16> = line.encode_utf16().collect();
                let mut rect = RECT {
                    left,
                    top: y,
                    right,
                    bottom: page_height - top,
                };
                let used_height =
                    unsafe { DrawTextW(hdc, &mut text, &mut rect, DT_WORDBREAK | DT_NOPREFIX) };
                unsafe {
                    let _ = SelectObject(hdc, old);
                    let _ = DeleteObject(font.into());
                }
                if used_height <= 0 || y + used_height > page_height - top {
                    uncertain = Some(
                        "Windows could not fit all text after the spool job was created".to_owned(),
                    );
                    break;
                }
                y += used_height + (base_line_height / 2).max(1);
            }
            if uncertain.is_some() {
                unsafe {
                    let _ = AbortDoc(hdc);
                }
                break;
            }
            if unsafe { EndPage(hdc) } <= 0 {
                uncertain =
                    Some("Windows spooler status was lost after page submission".to_owned());
                break;
            }
        }
        if uncertain.is_none() && unsafe { EndDoc(hdc) } <= 0 {
            uncertain =
                Some("Windows spooler status was lost after document submission".to_owned());
        }
        unsafe {
            let _ = DeleteDC(hdc);
        }
        if let Some(message) = uncertain {
            return Ok(SubmissionReceipt {
                os_job_id: Some(job_id.to_string()),
                accepted_at: now_rfc3339(),
                certainty: SubmissionCertainty::Uncertain,
                detail: Some(message),
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
        })
    }
    fn bill() -> PrintDocument {
        PrintDocument::Bill(BillDocument {
            order_number: "SL-103".into(),
            created_at_ist: "15 Oct 2026 10:30 IST".into(),
            promised_at_ist: "17 Oct 2026 17:00 IST".into(),
            customer_name: "Asha Patil".into(),
            customer_phone: "9876543210".into(),
            items: vec![BillItem {
                garment: "Kurta".into(),
                service: "Wash + Iron".into(),
                quantity: 1,
                unit_price_minor: 4500,
                line_total_minor: 4500,
            }],
            subtotal_minor: 4500,
            paid_minor: 1000,
            balance_minor: 3500,
            physical_piece_count: 1,
        })
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
    #[test]
    fn invalid_tag_position_rejected() {
        let PrintDocument::Tags(mut value) = tags() else {
            unreachable!()
        };
        value.pieces[0].position = 2;
        assert!(validate_document(&PrintDocument::Tags(value)).is_err());
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
        });
        assert!(validate_document(&out_of_range).is_err());
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn linux_destination_and_media_are_explicit_and_queue_text_is_one_argument() {
        let args = linux_adapter::lp_arguments("Canon; $(no-shell)", false);
        assert_eq!(
            args,
            [
                "-d",
                "Canon; $(no-shell)",
                "-o",
                "sides=one-sided",
                "-o",
                "media=A4",
                "-o",
                "fit-to-page",
                "--",
                "-"
            ]
        );
        let tags = linux_adapter::lp_arguments("TSC-TE244", true);
        assert!(tags.contains(&"media=Custom.50x50mm".into()));
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
        assert_eq!(safe_line(&text), "Asha [2J Patil");
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
