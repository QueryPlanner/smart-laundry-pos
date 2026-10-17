//! Throwaway demo-data generator (ignored test). Drives the REAL native order code for a realistic
//! stretch of shop life, then backdates timestamps so the data looks like it was entered day by day.
//!
//! Run:  DEMO_OUT_DIR=/some/empty/dir cargo test demo_seed -- --ignored --nocapture
//! Demo logins created here (demo data only): admin Mira Shah 2468, staff Asha Patil 1357,
//! staff Ravi Kulkarni 8642.

use crate::counter::{
    cancel_order, collect_order, login, quote, record_payment, save_order, set_discount, set_rate,
    setup_admin, update_order_status, AccountInput, CounterSession, CustomerInput, LineInput,
    OrderInput, PaymentInput, RecordPaymentInput, SaveInput,
};
use crate::printing::PrintDocument;
use crate::DatabaseState;
use chrono::{DateTime, Datelike, Duration, NaiveDate, Utc, Weekday};
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::path::PathBuf;

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
    fn chance(&mut self, percent: u64) -> bool {
        self.below(100) < percent
    }
    fn range(&mut self, low: u64, high: u64) -> u64 {
        low + self.below(high - low + 1)
    }
    fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        &items[self.below(items.len() as u64) as usize]
    }
}

const CUSTOMERS: [&str; 48] = [
    "Rahul Sharma",
    "Priya Deshmukh",
    "Amit Patil",
    "Sunita Joshi",
    "Vikram Kulkarni",
    "Anjali More",
    "Sachin Pawar",
    "Kavita Jadhav",
    "Rohit Shinde",
    "Neha Gaikwad",
    "Ganesh Bhosale",
    "Pooja Kale",
    "Suresh Chavan",
    "Meera Nair",
    "Deepak Wagh",
    "Shweta Salunke",
    "Manoj Thakur",
    "Rekha Kamble",
    "Nitin Ghorpade",
    "Swati Mane",
    "Ajay Mohite",
    "Madhuri Pande",
    "Prakash Dhumal",
    "Asha Raut",
    "Santosh Kadam",
    "Jyoti Bagal",
    "Sandeep Lokhande",
    "Vaishali Nikam",
    "Harish Rane",
    "Smita Apte",
    "Yogesh Sawant",
    "Archana Bhide",
    "Mahesh Gawade",
    "Lata Phadke",
    "Tushar Sutar",
    "Rani Waghmare",
    "Kiran Dange",
    "Seema Kulkarni",
    "Anil Tambe",
    "Usha Chitale",
    "Rajesh Karve",
    "Sarika Rokade",
    "Dinesh Hande",
    "Mangal Ingle",
    "Bhushan Joshi",
    "Alka Barve",
    "Hotel Sai Residency",
    "Sneha Tilak",
];

const DAILY: [&str; 7] = [
    "g-shirt",
    "g-tshirt",
    "g-jeans",
    "g-trousers",
    "g-shorts",
    "g-pyjama",
    "g-leggings",
];
const ETHNIC: [&str; 6] = [
    "g-saree",
    "g-kurta",
    "g-salwar",
    "g-dupatta",
    "g-blouse",
    "g-dhoti",
];
const OTHER: [&str; 4] = ["g-jacket", "g-sweater", "g-dress", "g-shoes"];

fn ist(date: NaiveDate, hour: u32, minute: u32) -> DateTime<Utc> {
    date.and_hms_opt(hour, minute, 0)
        .expect("valid time")
        .and_utc()
        - Duration::minutes(330)
}

fn stamp(at: DateTime<Utc>) -> String {
    at.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

fn lines_for(rng: &mut Rng) -> Vec<LineInput> {
    let mut lines: Vec<LineInput> = Vec::new();
    let mut add = |garment: &str, service: &str, quantity: u32| {
        if !lines
            .iter()
            .any(|l| l.garment_id == garment && l.service_id == service)
        {
            lines.push(LineInput {
                garment_id: garment.into(),
                service_id: service.into(),
                quantity,
            });
        }
    };
    let daily_service = |rng: &mut Rng| match rng.below(10) {
        0 => "svc-wash",
        1 | 2 => "svc-iron",
        _ => "svc-wash-iron",
    };
    // Some customers only want ironing. Those pieces are untagged, so the order gets no tags.
    if rng.chance(12) {
        for _ in 0..rng.range(1, 2) {
            let g = *rng.pick(&DAILY);
            add(g, "svc-iron", rng.range(1, 5) as u32);
        }
        return lines;
    }
    match rng.below(100) {
        0..=59 => {
            for _ in 0..rng.range(1, 3) {
                let g = *rng.pick(&DAILY);
                let s = daily_service(rng);
                add(g, s, rng.range(1, 6) as u32);
            }
        }
        60..=79 => {
            for _ in 0..rng.range(1, 2) {
                let g = *rng.pick(&ETHNIC);
                let s = if rng.chance(60) {
                    "svc-dry-clean"
                } else {
                    "svc-wash-iron"
                };
                add(g, s, rng.range(1, 3) as u32);
            }
        }
        80..=94 => {
            let g = *rng.pick(&DAILY);
            let s = daily_service(rng);
            add(g, s, rng.range(2, 5) as u32);
            let e = *rng.pick(&ETHNIC);
            add(e, "svc-dry-clean", rng.range(1, 2) as u32);
        }
        _ => {
            let g = *rng.pick(&OTHER);
            let s = if g == "g-shoes" {
                if rng.chance(50) {
                    "svc-wash"
                } else {
                    "svc-dry-clean"
                }
            } else {
                "svc-dry-clean"
            };
            add(g, s, rng.range(1, 2) as u32);
        }
    }
    lines
}

fn payment_method(rng: &mut Rng) -> &'static str {
    match rng.below(100) {
        0..=54 => "cash",
        55..=89 => "upi",
        _ => "card",
    }
}

/// Gives each order its back-dated bill number: the IST day it was received, with a sequence that
/// restarts each day, as the live code would have numbered it. Printed documents are rewritten to
/// match, so reprints and piece tags agree with the order.
async fn renumber_bills_by_day(pool: &SqlitePool, sims: &[Sim]) {
    sqlx::query("DELETE FROM order_day_sequences")
        .execute(pool)
        .await
        .unwrap();
    let mut orders_on_day: HashMap<String, i64> = HashMap::new();
    for sim in sims {
        let day = (sim.received + Duration::minutes(330))
            .format("%Y%m%d")
            .to_string();
        let count = orders_on_day.entry(day.clone()).or_insert(0);
        *count += 1;
        let seq = *count;
        let order_no = format!("{day}{seq:04}");
        let pieces: Vec<(String, i64)> =
            sqlx::query_as("SELECT short_id,position FROM order_pieces WHERE order_id=?")
                .bind(&sim.id)
                .fetch_all(pool)
                .await
                .unwrap();
        let mut short_ids: HashMap<String, String> = HashMap::new();
        for (old, position) in &pieces {
            let new = format!("{}{seq:04}-{position}", &day[2..]);
            sqlx::query("UPDATE order_pieces SET short_id=? WHERE order_id=? AND short_id=?")
                .bind(&new)
                .bind(&sim.id)
                .bind(old)
                .execute(pool)
                .await
                .unwrap();
            short_ids.insert(old.clone(), new);
        }
        sqlx::query("UPDATE orders SET order_number=? WHERE id=?")
            .bind(&order_no)
            .bind(&sim.id)
            .execute(pool)
            .await
            .unwrap();
        let jobs: Vec<(String, String)> =
            sqlx::query_as("SELECT id,payload_json FROM print_jobs WHERE order_id=?")
                .bind(&sim.id)
                .fetch_all(pool)
                .await
                .unwrap();
        for (job_id, payload) in jobs {
            let mut document: PrintDocument = serde_json::from_str(&payload).unwrap();
            match &mut document {
                PrintDocument::Bill(bill) => bill.order_number = order_no.clone(),
                PrintDocument::Tags(tags) => {
                    tags.order_number = order_no.clone();
                    for piece in &mut tags.pieces {
                        piece.piece_id = short_ids
                            .get(&piece.piece_id)
                            .expect("a tag belongs to a piece of its order")
                            .clone();
                    }
                }
            }
            sqlx::query("UPDATE print_jobs SET payload_json=? WHERE id=?")
                .bind(serde_json::to_string(&document).unwrap())
                .bind(job_id)
                .execute(pool)
                .await
                .unwrap();
        }
    }
    for (day, count) in orders_on_day {
        sqlx::query("INSERT INTO order_day_sequences(day,next_number) VALUES(?,?)")
            .bind(day)
            .bind(count + 1)
            .execute(pool)
            .await
            .unwrap();
    }
}

fn typed_phone(base: &str, rng: &mut Rng) -> String {
    match rng.below(10) {
        0 => format!("+91 {base}"),
        1 => format!("{} {}", &base[..5], &base[5..]),
        _ => base.to_string(),
    }
}

struct Sim {
    id: String,
    received: DateTime<Utc>,
    due: DateTime<Utc>,
    piece_ids: Vec<String>,
    /// Still owed when the order was saved (the balance is taken at collection).
    balance_minor: i64,
    /// When the balance was taken, if it was.
    settled_at: Option<DateTime<Utc>>,
    last_event: DateTime<Utc>,
    collected_at: Option<DateTime<Utc>>,
    cancelled_at: Option<DateTime<Utc>>,
}

#[test]
#[ignore = "generates demo data; run explicitly with DEMO_OUT_DIR set"]
fn seed_demo_month() {
    tauri::async_runtime::block_on(async {
        let out = PathBuf::from(std::env::var("DEMO_OUT_DIR").expect("set DEMO_OUT_DIR"));
        std::fs::create_dir_all(&out).unwrap();
        let db = DatabaseState::open(out.join("laundry.db")).await;
        assert_eq!(db.info().error, None);
        let pool = db.writer_pool().unwrap();
        let mut rng = Rng(0x5eed_1234_abcd_9876);

        // Accounts through the real setup and sign-in code.
        let admin = CounterSession::default();
        setup_admin(
            &db,
            &admin,
            AccountInput {
                full_name: "Mira Shah".into(),
                pin: "2468".into(),
            },
        )
        .await
        .unwrap();
        let mut staff_ids = Vec::new();
        for (name, pin) in [("Asha Patil", "1357"), ("Ravi Kulkarni", "8642")] {
            let created = crate::counter::create_staff(
                &db,
                &admin,
                AccountInput {
                    full_name: name.into(),
                    pin: pin.into(),
                },
            )
            .await
            .unwrap();
            staff_ids.push((created.id, pin));
        }
        let mut staff_sessions = Vec::new();
        for (id, pin) in &staff_ids {
            let session = CounterSession::default();
            login(&db, &session, id.clone(), (*pin).to_string())
                .await
                .unwrap();
            staff_sessions.push(session);
        }

        let first_day = NaiveDate::from_ymd_opt(2026, 9, 1).unwrap();
        let last_day = NaiveDate::from_ymd_opt(2026, 10, 14).unwrap();
        let mut sims: Vec<Sim> = Vec::new();
        let mut day = first_day;
        let mut customer_rules_set = 0usize;
        let mut ordered_before: Vec<usize> = Vec::new();
        let mut order_key = 0u64;

        while day <= last_day {
            // Business events on particular days.
            if day == NaiveDate::from_ymd_opt(2026, 9, 16).unwrap() {
                set_rate(&db, &admin, "g-shirt", "svc-wash-iron", Some(2800), true)
                    .await
                    .unwrap();
                set_rate(&db, &admin, "g-trousers", "svc-wash-iron", Some(3200), true)
                    .await
                    .unwrap();
            }
            if day == NaiveDate::from_ymd_opt(2026, 9, 25).unwrap() {
                set_rate(&db, &admin, "g-saree", "svc-dry-clean", Some(22000), true)
                    .await
                    .unwrap();
            }
            if day == NaiveDate::from_ymd_opt(2026, 9, 20).unwrap() {
                set_discount(&db, &admin, None, 1000, true, "Navratri offer")
                    .await
                    .unwrap();
            }
            if day == NaiveDate::from_ymd_opt(2026, 9, 23).unwrap() {
                set_discount(&db, &admin, None, 1000, false, "Navratri offer")
                    .await
                    .unwrap();
            }

            let sunday = day.weekday() == Weekday::Sun;
            let busy = day.weekday() == Weekday::Sat || sunday;
            let count = if busy {
                rng.range(20, 28)
            } else {
                rng.range(13, 19)
            };
            let mut minutes: Vec<u64> = (0..count)
                .map(|_| rng.range(9 * 60, 20 * 60 + 30))
                .collect();
            minutes.sort_unstable();

            for (n, minute) in minutes.iter().enumerate() {
                order_key += 1;
                let bulk = day == NaiveDate::from_ymd_opt(2026, 9, 14).unwrap() && n == 2;
                let who = if bulk {
                    CUSTOMERS.len() - 2
                } else if !ordered_before.is_empty() && rng.chance(55) {
                    ordered_before[rng.below(ordered_before.len() as u64) as usize]
                } else {
                    rng.below((CUSTOMERS.len() - 2) as u64) as usize
                };
                let base_phone = if who == 10 || who == 11 {
                    "9822000111".to_string() // two people sharing one phone
                } else {
                    format!("98{:08}", 20_000_000 + who as u64 * 1_713_007 % 79_999_999)
                };
                let items = if bulk {
                    vec![
                        LineInput {
                            garment_id: "g-shirt".into(),
                            service_id: "svc-wash-iron".into(),
                            quantity: 60,
                        },
                        LineInput {
                            garment_id: "g-trousers".into(),
                            service_id: "svc-wash-iron".into(),
                            quantity: 40,
                        },
                        LineInput {
                            garment_id: "g-jacket".into(),
                            service_id: "svc-dry-clean".into(),
                            quantity: 20,
                        },
                    ]
                } else {
                    lines_for(&mut rng)
                };
                let order = OrderInput {
                    customer: CustomerInput {
                        name: CUSTOMERS[who].to_string(),
                        phone: typed_phone(&base_phone, &mut rng),
                        customer_id: None,
                    },
                    items,
                };
                let session = &staff_sessions[(order_key % 2) as usize];
                let reviewed = quote(&db, session, &order).await.unwrap();
                let total = reviewed.total_minor;
                // Customers leave nothing, part or all of the total as an advance.
                let advance_minor = match rng.below(100) {
                    0..=34 => 0,
                    35..=64 => total * rng.range(20, 80) as i64 / 100,
                    _ => total,
                };
                let method = payment_method(&mut rng);
                let payment = (advance_minor > 0).then(|| PaymentInput {
                    amount_minor: advance_minor,
                    method: method.to_string(),
                    reference: (method == "upi")
                        .then(|| format!("UTR{:010}", rng.below(9_999_999_999))),
                });
                let saved = save_order(
                    &db,
                    session,
                    SaveInput {
                        order,
                        idempotency_key: format!("demo-{order_key}"),
                        payment,
                        reviewed_quote: reviewed,
                    },
                )
                .await
                .unwrap();

                if !ordered_before.contains(&who) {
                    ordered_before.push(who);
                    // A few regulars are given their own standing discount after their first visit.
                    if customer_rules_set < 6 && rng.chance(18) {
                        let id: String =
                            sqlx::query_scalar("SELECT customer_id FROM orders WHERE id=?")
                                .bind(&saved.order_id)
                                .fetch_one(pool)
                                .await
                                .unwrap();
                        let bp = *rng.pick(&[500i64, 700, 1000, 1500]);
                        set_discount(&db, &admin, Some(&id), bp, true, "Regular customer")
                            .await
                            .unwrap();
                        customer_rules_set += 1;
                    }
                }
                let received = ist(day, (*minute / 60) as u32, (*minute % 60) as u32);
                sims.push(Sim {
                    id: saved.order_id.clone(),
                    received,
                    due: ist(day + Duration::days(2), 17, 0),
                    piece_ids: saved.pieces.iter().map(|p| p.id.clone()).collect(),
                    balance_minor: saved.balance_minor,
                    settled_at: None,
                    last_event: received,
                    collected_at: None,
                    cancelled_at: None,
                });
            }
            day += Duration::days(1);
        }

        // Lifecycle: mistakes get cancelled, work moves through the plant, customers collect.
        let end_of_data = ist(last_day, 21, 0);
        for (index, sim) in sims.iter_mut().enumerate() {
            let session = &staff_sessions[index % 2];
            if rng.chance(2) {
                let at = sim.received + Duration::hours(1);
                cancel_order(&db, &admin, &sim.id, "Entered twice by mistake")
                    .await
                    .unwrap();
                sim.cancelled_at = Some(at);
                sim.last_event = at;
                continue;
            }
            let age = end_of_data - sim.received;
            let target = if age < Duration::hours(6) {
                "washing"
            } else if age < Duration::hours(20) {
                "drying"
            } else if age < Duration::hours(30) {
                "ironing"
            } else if age < Duration::hours(40) {
                "packing"
            } else {
                "ready"
            };
            update_order_status(&db, session, &sim.id, target)
                .await
                .unwrap();
            sim.last_event = sim.received + Duration::hours(30);
            if target == "ready" && rng.chance(88) {
                let collect_day = sim.due.date_naive() + Duration::days(rng.below(3) as i64);
                let at = ist(
                    collect_day + Duration::days(0),
                    rng.range(10, 19) as u32,
                    rng.range(0, 59) as u32,
                );
                if at < end_of_data && at > sim.received + Duration::hours(24) {
                    if sim.balance_minor > 0 {
                        // The balance is paid at the counter before the order is handed back.
                        record_payment(
                            &db,
                            session,
                            &sim.id,
                            RecordPaymentInput {
                                amount_minor: sim.balance_minor,
                                method: payment_method(&mut rng).into(),
                                reference: None,
                                idempotency_key: format!("balance-{index}"),
                            },
                        )
                        .await
                        .unwrap();
                        sim.settled_at = Some(at);
                    }
                    collect_order(
                        &db,
                        session,
                        &sim.id,
                        sim.piece_ids.clone(),
                        &format!("collect-{index}"),
                        None,
                    )
                    .await
                    .unwrap();
                    sim.collected_at = Some(at);
                    sim.last_event = at;
                }
            }
        }

        // Backdate everything the real code stamped with "now".
        for sim in &sims {
            let received = stamp(sim.received);
            let updated = stamp(sim.last_event);
            let due = stamp(sim.due);
            sqlx::query("UPDATE orders SET received_at=?1,created_at=?1,expected_ready_at=?2,updated_at=?3 WHERE id=?4")
                .bind(&received).bind(&due).bind(&updated).bind(&sim.id).execute(pool).await.unwrap();
            sqlx::query("UPDATE order_items SET created_at=? WHERE order_id=?")
                .bind(&received)
                .bind(&sim.id)
                .execute(pool)
                .await
                .unwrap();
            sqlx::query("UPDATE order_pieces SET created_at=? WHERE order_id=?")
                .bind(&received)
                .bind(&sim.id)
                .execute(pool)
                .await
                .unwrap();
            sqlx::query(
                "UPDATE payments SET recorded_at=?1,created_at=?1,updated_at=?1 WHERE order_id=?2 AND kind='advance'",
            )
            .bind(&received)
            .bind(&sim.id)
            .execute(pool)
            .await
            .unwrap();
            if let Some(at) = sim.settled_at {
                sqlx::query(
                    "UPDATE payments SET recorded_at=?1,created_at=?1,updated_at=?1 WHERE order_id=?2 AND kind='settlement'",
                )
                .bind(stamp(at))
                .bind(&sim.id)
                .execute(pool)
                .await
                .unwrap();
            }
            sqlx::query("UPDATE counter_order_requests SET created_at=? WHERE order_id=?")
                .bind(&received)
                .bind(&sim.id)
                .execute(pool)
                .await
                .unwrap();
            sqlx::query("UPDATE print_jobs SET created_at=?1,updated_at=?1 WHERE order_id=?2")
                .bind(&received)
                .bind(&sim.id)
                .execute(pool)
                .await
                .unwrap();
            if let Some(at) = sim.collected_at {
                sqlx::query("UPDATE piece_matches SET matched_at=? WHERE order_id=?")
                    .bind(stamp(at))
                    .bind(&sim.id)
                    .execute(pool)
                    .await
                    .unwrap();
            }
            if let Some(at) = sim.cancelled_at {
                sqlx::query("UPDATE payments SET voided_at=?1,updated_at=?1 WHERE order_id=?2")
                    .bind(stamp(at))
                    .bind(&sim.id)
                    .execute(pool)
                    .await
                    .unwrap();
            }
        }
        renumber_bills_by_day(pool, &sims).await;
        sqlx::query("UPDATE customers SET created_at=(SELECT MIN(received_at) FROM orders WHERE customer_id=customers.id),updated_at=(SELECT MIN(received_at) FROM orders WHERE customer_id=customers.id) WHERE EXISTS (SELECT 1 FROM orders WHERE customer_id=customers.id)")
            .execute(pool).await.unwrap();
        // The shop's printers worked on a normal day: most output went to paper. The newest orders
        // are left waiting and one tag job failed, so the print queue is not empty.
        sqlx::query("UPDATE print_jobs SET state='submitted',printer_id='Demo printer' WHERE order_id IN (SELECT id FROM orders ORDER BY received_at DESC LIMIT -1 OFFSET 4)")
            .execute(pool).await.unwrap();
        sqlx::query("UPDATE print_jobs SET state='failed',last_error='Demo: printer offline' WHERE id=(SELECT id FROM print_jobs WHERE kind='tags' AND state='pending' ORDER BY created_at DESC LIMIT 1)")
            .execute(pool).await.unwrap();

        let orders: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM orders")
            .fetch_one(pool)
            .await
            .unwrap();
        let cancelled: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM orders WHERE status='cancelled'")
                .fetch_one(pool)
                .await
                .unwrap();
        let collected: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM orders WHERE status='collected'")
                .fetch_one(pool)
                .await
                .unwrap();
        let pieces: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM order_pieces")
            .fetch_one(pool)
            .await
            .unwrap();
        eprintln!("SEEDED orders={orders} cancelled={cancelled} collected={collected} pieces={pieces} customers_rules={customer_rules_set}");
        sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
            .execute(pool)
            .await
            .unwrap();
    });
}
