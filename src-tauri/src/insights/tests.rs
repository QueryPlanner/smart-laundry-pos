use super::*;
use crate::counter::SessionActor;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::async_runtime::block_on;

static NEXT: AtomicU64 = AtomicU64::new(0);

struct DirGuard(PathBuf);
impl Drop for DirGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// A scratch database. `db` is declared first so it is closed before the folder is removed.
struct Shop {
    db: DatabaseState,
    _dir: DirGuard,
}

/// IST wall-clock `YYYY-MM-DDTHH:MM[:SS]` as the UTC instant `save_order` stores.
fn z(local: &str) -> String {
    format!("{}.000Z", utc_of(local))
}
/// The same instant as `record_payment` / `cancel_order` store it.
fn plus(local: &str) -> String {
    format!("{}+00:00", utc_of(local))
}
fn utc_of(local: &str) -> String {
    let padded = if local.len() == 16 {
        format!("{local}:00")
    } else {
        local.to_string()
    };
    let naive = NaiveDateTime::parse_from_str(&padded, "%Y-%m-%dT%H:%M:%S").unwrap();
    (naive - Duration::seconds(IST_OFFSET_SECONDS))
        .format("%Y-%m-%dT%H:%M:%S")
        .to_string()
}

fn session(id: &str, role: &str) -> CounterSession {
    let session = CounterSession::default();
    session
        .set(SessionActor {
            id: id.into(),
            role: role.into(),
        })
        .unwrap();
    session
}
fn admin() -> CounterSession {
    session("admin-1", "admin")
}
fn staff() -> CounterSession {
    session("staff-1", "staff")
}

fn filter(from: &str, to: &str) -> SalesFilter {
    SalesFilter {
        from: from.into(),
        to: to.into(),
        payment_methods: vec![],
        statuses: vec![],
        staff_id: None,
        search: None,
        discounted_only: false,
        include_cancelled: false,
    }
}

struct Order {
    id: String,
    number: String,
    received_at: String,
    status: &'static str,
    subtotal: i64,
    discount: i64,
    by: &'static str,
    name: String,
    phone: String,
    pieces: u32,
    service: &'static str,
    updated_at: Option<String>,
    promised: Option<String>,
}

fn order(id: &str, received_at: &str) -> Order {
    Order {
        id: id.into(),
        number: format!("LA-{id}"),
        received_at: received_at.into(),
        status: "collected",
        subtotal: 10_000,
        discount: 0,
        by: "staff-1",
        name: "Walk In".into(),
        phone: "9990000000".into(),
        pieces: 1,
        service: "Wash",
        updated_at: None,
        promised: None,
    }
}

impl Order {
    fn status(mut self, status: &'static str) -> Self {
        self.status = status;
        self
    }
    fn money(mut self, subtotal: i64, discount: i64) -> Self {
        self.subtotal = subtotal;
        self.discount = discount;
        self
    }
    fn by(mut self, by: &'static str) -> Self {
        self.by = by;
        self
    }
    fn customer(mut self, name: &str, phone: &str) -> Self {
        self.name = name.into();
        self.phone = phone.into();
        self
    }
    fn pieces(mut self, pieces: u32) -> Self {
        self.pieces = pieces;
        self
    }
    fn service(mut self, service: &'static str) -> Self {
        self.service = service;
        self
    }
    fn number(mut self, number: &str) -> Self {
        self.number = number.into();
        self
    }
    fn updated(mut self, at: &str) -> Self {
        self.updated_at = Some(at.into());
        self
    }
    fn promised(mut self, at: &str) -> Self {
        self.promised = Some(at.into());
        self
    }
}

fn rupees(minor: i64) -> f64 {
    minor as f64 / 100.0
}

impl Shop {
    async fn new() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "insights-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let db = DatabaseState::open(dir.join("shop.db")).await;
        let shop = Self {
            db,
            _dir: DirGuard(dir),
        };
        shop.account("admin-1", "Meera Shah", "admin", true).await;
        shop.account("staff-1", "Asha Patil", "staff", true).await;
        shop.account("staff-2", "Ravi Kulkarni", "staff", true)
            .await;
        shop
    }

    async fn run(&self, sql: &str) {
        sqlx::query(sql)
            .execute(self.db.writer_pool().unwrap())
            .await
            .unwrap();
    }

    async fn account(&self, id: &str, name: &str, role: &str, active: bool) {
        let pool = self.db.writer_pool().unwrap();
        sqlx::query("INSERT INTO local_users(id,full_name,pin_hash,pin_salt,role,created_at,updated_at) VALUES(?,?,'x','x','admin','2026-01-01','2026-01-01')")
            .bind(id).bind(name).execute(pool).await.unwrap();
        sqlx::query("INSERT INTO counter_accounts(id,full_name,pin_hash,pin_salt,role,active,created_at,updated_at) VALUES(?,?,'x','x',?,?,'2026-01-01','2026-01-01')")
            .bind(id).bind(name).bind(role).bind(active as i64).execute(pool).await.unwrap();
    }

    async fn add(&self, o: Order) {
        let pool = self.db.writer_pool().unwrap();
        let total = o.subtotal - o.discount;
        let updated = o
            .updated_at
            .clone()
            .unwrap_or_else(|| o.received_at.clone());
        sqlx::query("INSERT INTO orders(id,order_number,customer_name,customer_phone,order_type,received_at,expected_ready_at,status,subtotal,discount_amount,total_amount,created_by,created_at,updated_at,origin_device_id) VALUES(?,?,?,?,'piece',?,?,?,?,?,?,?,?,?,'test')")
            .bind(&o.id).bind(&o.number).bind(&o.name).bind(&o.phone).bind(&o.received_at)
            .bind(&o.promised).bind(o.status).bind(rupees(o.subtotal)).bind(rupees(o.discount))
            .bind(rupees(total)).bind(o.by).bind(&o.received_at).bind(&updated)
            .execute(pool).await.unwrap();
        if o.pieces == 0 {
            return;
        }
        let item = format!("item-{}", o.id);
        sqlx::query("INSERT INTO order_items(id,order_id,item_name,service_name,service_type,quantity,rate,line_total,created_at,line_total_minor) VALUES(?,?,?,?,'piece',?,0,?,?,?)")
            .bind(&item).bind(&o.id).bind("Shirt").bind(o.service).bind(o.pieces as f64)
            .bind(rupees(o.subtotal)).bind(&o.received_at).bind(o.subtotal)
            .execute(pool).await.unwrap();
        for position in 1..=o.pieces {
            sqlx::query("INSERT INTO order_pieces(id,short_id,order_id,order_item_id,garment_snapshot,service_snapshot,position,total,created_at) VALUES(?,?,?,?,'Shirt',?,?,?,?)")
                .bind(format!("piece-{}-{position}", o.id)).bind(format!("{}-{position}", o.id))
                .bind(&o.id).bind(&item).bind(o.service).bind(position as i64).bind(o.pieces as i64)
                .bind(&o.received_at).execute(pool).await.unwrap();
        }
    }

    async fn pay(&self, id: &str, order_id: &str, minor: i64, method: &str, at: &str, by: &str) {
        sqlx::query("INSERT INTO payments(id,order_id,amount,method,recorded_at,recorded_by,created_at,updated_at,origin_device_id) VALUES(?,?,?,?,?,?,?,?,'test')")
            .bind(id).bind(order_id).bind(rupees(minor)).bind(method).bind(at).bind(by)
            .bind(at).bind(at)
            .execute(self.db.writer_pool().unwrap()).await.unwrap();
    }

    async fn void(&self, payment_id: &str, at: &str) {
        sqlx::query("UPDATE payments SET voided_at=?, voided_by='admin-1', void_reason='order cancelled' WHERE id=?")
            .bind(at).bind(payment_id)
            .execute(self.db.writer_pool().unwrap()).await.unwrap();
    }

    async fn audit(&self, action: &str, order_id: &str, at: &str) {
        sqlx::query("INSERT INTO counter_audit(id,actor_id,action,entity_type,entity_id,details_json,created_at) VALUES(?,?,?,'order',?,'{}',?)")
            .bind(format!("audit-{action}-{order_id}-{at}")).bind("admin-1").bind(action)
            .bind(order_id).bind(at)
            .execute(self.db.writer_pool().unwrap()).await.unwrap();
    }

    async fn expense(&self, id: &str, date: &str, minor: i64) {
        sqlx::query("INSERT INTO expenses(id,expense_date,category,amount,payment_method,created_by,created_at,updated_at,origin_device_id) VALUES(?,?,'Supplies',?,'cash','staff-1','2026-01-01','2026-01-01','test')")
            .bind(id).bind(date).bind(rupees(minor))
            .execute(self.db.writer_pool().unwrap()).await.unwrap();
    }

    /// A month boundary story: money taken in January, handed back in February.
    async fn story(&self) {
        // o1: January, discounted, paid in cash by Asha.
        self.add(
            order("o1", &z("2026-01-31T23:30"))
                .status("ready")
                .money(30_000, 3_000)
                .pieces(2)
                .service("Wash + Iron")
                .customer("Rita Joshi", "9876543210"),
        )
        .await;
        self.pay(
            "p1",
            "o1",
            27_000,
            "cash",
            &plus("2026-01-31T23:31"),
            "staff-1",
        )
        .await;
        // o2: created exactly at the February boundary, paid by UPI by Ravi.
        self.add(
            order("o2", &z("2026-02-01T00:00"))
                .money(10_000, 0)
                .by("staff-2")
                .service("Iron"),
        )
        .await;
        self.pay(
            "p2",
            "o2",
            10_000,
            "upi",
            &plus("2026-02-01T00:05"),
            "staff-2",
        )
        .await;
        // o3: January, paid, then cancelled on 2 February (payment voided then).
        self.add(
            order("o3", &z("2026-01-31T10:00"))
                .status("cancelled")
                .money(5_000, 0),
        )
        .await;
        self.pay(
            "p3",
            "o3",
            5_000,
            "cash",
            &plus("2026-01-31T10:01"),
            "staff-1",
        )
        .await;
        self.void("p3", &plus("2026-02-02T11:00")).await;
        self.audit("order_cancelled", "o3", &plus("2026-02-02T11:00"))
            .await;
        // o4: February, paid in two instalments by two people.
        self.add(
            order("o4", &z("2026-02-10T11:00"))
                .money(20_000, 0)
                .by("staff-2")
                .service("Dry Clean")
                .pieces(3),
        )
        .await;
        self.pay(
            "p4a",
            "o4",
            8_000,
            "card",
            &plus("2026-02-10T12:00"),
            "staff-2",
        )
        .await;
        self.pay(
            "p4b",
            "o4",
            12_000,
            "cash",
            &plus("2026-02-12T09:00"),
            "staff-1",
        )
        .await;
        self.expense("e1", "2026-01-31", 1_500).await;
        self.expense("e2", "2026-02-03", 2_500).await;
    }
}

fn jan() -> SalesFilter {
    filter("2026-01-01T00:00", "2026-02-01T00:00")
}
fn feb() -> SalesFilter {
    filter("2026-02-01T00:00", "2026-03-01T00:00")
}
fn both() -> SalesFilter {
    filter("2026-01-01T00:00", "2026-03-01T00:00")
}

async fn summary(shop: &Shop, f: &SalesFilter) -> SalesSummary {
    sales_summary(&shop.db, &admin(), f).await.unwrap()
}
async fn orders_of(shop: &Shop, f: &SalesFilter) -> Page<SalesOrderRow> {
    sales_orders(&shop.db, &admin(), f, 0, 100).await.unwrap()
}
async fn txns_of(shop: &Shop, f: &SalesFilter) -> Page<TransactionRow> {
    sales_transactions(&shop.db, &admin(), f, 0, 100)
        .await
        .unwrap()
}
fn numbers(page: &Page<SalesOrderRow>) -> Vec<String> {
    page.items.iter().map(|o| o.id.clone()).collect()
}

#[test]
fn every_query_needs_a_signed_in_account() {
    block_on(async {
        let shop = Shop::new().await;
        let nobody = CounterSession::default();
        let f = jan();
        assert!(dashboard_overview_at(&shop.db, &nobody, Utc::now())
            .await
            .unwrap_err()
            .contains("Log in"));
        assert!(sales_summary(&shop.db, &nobody, &f).await.is_err());
        assert!(sales_series(&shop.db, &nobody, &f, "day").await.is_err());
        assert!(sales_orders(&shop.db, &nobody, &f, 0, 10).await.is_err());
        assert!(sales_transactions(&shop.db, &nobody, &f, 0, 10)
            .await
            .is_err());
        assert!(sales_staff_options(&shop.db, &nobody).await.is_err());
    });
}

#[test]
fn staff_and_admin_see_identical_results() {
    block_on(async {
        let shop = Shop::new().await;
        shop.story().await;
        let (a, s) = (admin(), staff());
        let now = DateTime::parse_from_rfc3339("2026-02-20T06:30:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let f = both();
        macro_rules! same {
            ($call:expr) => {{
                let for_admin = serde_json::to_value($call(&a).await.unwrap()).unwrap();
                let for_staff = serde_json::to_value($call(&s).await.unwrap()).unwrap();
                assert_eq!(for_admin, for_staff);
                for_admin
            }};
        }
        let summary = same!(|who| sales_summary(&shop.db, who, &f));
        assert_eq!(summary["orders"], 3);
        same!(|who| sales_series(&shop.db, who, &f, "day"));
        let orders = same!(|who| sales_orders(&shop.db, who, &f, 0, 50));
        assert_eq!(orders["total"], 3);
        let txns = same!(|who| sales_transactions(&shop.db, who, &f, 0, 50));
        assert_eq!(txns["total"], 6);
        let staff = same!(|who| sales_staff_options(&shop.db, who));
        assert_eq!(
            staff.as_array().unwrap().len(),
            2,
            "only accounts with sales"
        );
        same!(|who| dashboard_overview_at(&shop.db, who, now));
    });
}

#[test]
fn bad_input_is_rejected_with_a_clear_message() {
    block_on(async {
        let shop = Shop::new().await;
        let admin = admin();
        let err = |f: SalesFilter| {
            let db = &shop.db;
            let admin = &admin;
            async move { sales_summary(db, admin, &f).await.unwrap_err() }
        };
        assert!(err(filter("2026-03-05", "2026-03-06T00:00"))
            .await
            .contains("From must be"));
        assert!(err(filter("2026-03-05T00:00", "2026-03-06 00:00"))
            .await
            .contains("To must be"));
        assert!(err(filter("2026-13-05T00:00", "2026-14-06T00:00"))
            .await
            .contains("From must be"));
        assert!(err(filter("1999-01-01T00:00", "2026-01-01T00:00"))
            .await
            .contains("From must be"));
        assert!(err(filter("2026-03-05T00:00", "2026-03-05T00:00"))
            .await
            .contains("after its start"));
        assert!(err(filter("2026-03-06T00:00", "2026-03-05T00:00"))
            .await
            .contains("after its start"));
        assert!(err(filter("2000-01-01T00:00", "2026-01-01T00:00"))
            .await
            .contains("10 years"));
        let mut f = jan();
        f.payment_methods = vec!["bitcoin".into()];
        assert!(err(f).await.contains("Unknown payment method 'bitcoin'"));
        let mut f = jan();
        f.statuses = vec!["lost".into()];
        assert!(err(f).await.contains("Unknown status"));
        let mut f = jan();
        f.statuses = STATUSES
            .iter()
            .chain(&["x"])
            .map(|s| s.to_string())
            .collect();
        assert!(err(f).await.contains("Too many"));
        let mut f = jan();
        f.search = Some("x".repeat(101));
        assert!(err(f).await.contains("too long"));
        let mut f = jan();
        f.staff_id = Some("x".repeat(101));
        assert!(err(f).await.contains("staff filter"));

        let f = jan();
        assert!(sales_series(&shop.db, &admin, &f, "week")
            .await
            .unwrap_err()
            .contains("hour, day or month"));
        let long = filter("2026-01-01T00:00", "2026-03-01T00:00");
        assert!(sales_series(&shop.db, &admin, &long, "hour")
            .await
            .unwrap_err()
            .contains("hourly graph can cover at most 31 days"));
        let year_plus = filter("2025-01-01T00:00", "2026-03-01T00:00");
        assert!(sales_series(&shop.db, &admin, &year_plus, "day")
            .await
            .unwrap_err()
            .contains("daily graph can cover at most 366 days"));
        assert!(sales_series(&shop.db, &admin, &year_plus, "month")
            .await
            .is_ok());

        for (offset, limit) in [(0, 0), (0, 101), (100_001, 10)] {
            assert!(sales_orders(&shop.db, &admin, &f, offset, limit)
                .await
                .unwrap_err()
                .contains("Choose a page"));
            assert!(sales_transactions(&shop.db, &admin, &f, offset, limit)
                .await
                .is_err());
        }
        assert!(sales_orders(&shop.db, &admin, &f, 100_000, 100)
            .await
            .is_ok());
    });
}

#[test]
fn an_empty_database_gives_zeros_and_zero_filled_graphs() {
    block_on(async {
        let shop = Shop::new().await;
        let s = summary(&shop, &jan()).await;
        assert_eq!(
            (s.orders, s.pieces, s.net_billed_minor, s.collected_minor),
            (0, 0, 0, 0)
        );
        assert_eq!(
            (s.average_order_minor, s.refunded_minor, s.cancelled_count),
            (0, 0, 0)
        );
        assert_eq!(s.profit_minor, Some(0));
        assert!(
            s.by_method.is_empty()
                && s.by_status.is_empty()
                && s.by_staff.is_empty()
                && s.by_service.is_empty()
        );
        let day = filter("2026-03-05T00:00", "2026-03-08T00:00");
        let series = sales_series(&shop.db, &admin(), &day, "day").await.unwrap();
        assert_eq!(series.bucket, "day");
        assert_eq!(series.points.len(), 3);
        assert_eq!(series.points[0], SeriesPoint::empty("2026-03-05".into()));
        let one_day = filter("2026-03-05T00:00", "2026-03-06T00:00");
        assert_eq!(
            sales_series(&shop.db, &admin(), &one_day, "hour")
                .await
                .unwrap()
                .points
                .len(),
            24
        );
        assert_eq!(
            sales_series(&shop.db, &admin(), &one_day, "month")
                .await
                .unwrap()
                .points
                .len(),
            1
        );
        assert_eq!(
            orders_of(&shop, &jan()).await,
            Page {
                items: vec![],
                total: 0
            }
        );
        assert_eq!(txns_of(&shop, &jan()).await.total, 0);
        assert!(sales_staff_options(&shop.db, &admin())
            .await
            .unwrap()
            .is_empty());
        let overview = dashboard_overview_at(&shop.db, &admin(), Utc::now())
            .await
            .unwrap();
        assert_eq!(
            overview.queue,
            QueueCounts {
                received: 0,
                in_process: 0,
                ready: 0
            }
        );
        assert_eq!(overview.today.orders, 0);
        assert!(overview.recent_orders.is_empty());
        assert_eq!(
            (
                overview.ready_waiting.total,
                overview.in_process.total,
                overview.low_stock_count
            ),
            (0, 0, 0)
        );
    });
}

#[test]
fn zero_fill_covers_partial_windows_and_year_ends() {
    let at = |s: &str| NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M").unwrap();
    // A window starting mid-hour still names that hour; the end is exclusive.
    let hours = bucket_keys(at("2026-03-05T09:30"), at("2026-03-05T11:00"), Bucket::Hour);
    assert_eq!(hours, ["2026-03-05T09:00", "2026-03-05T10:00"]);
    let hours = bucket_keys(at("2026-03-05T09:30"), at("2026-03-05T11:01"), Bucket::Hour);
    assert_eq!(hours.len(), 3);
    let days = bucket_keys(at("2026-03-05T18:00"), at("2026-03-07T00:00"), Bucket::Day);
    assert_eq!(days, ["2026-03-05", "2026-03-06"]);
    let months = bucket_keys(
        at("2025-12-15T00:00"),
        at("2026-02-02T00:00"),
        Bucket::Month,
    );
    assert_eq!(months, ["2025-12", "2026-01", "2026-02"]);
    let months = bucket_keys(
        at("2026-01-01T00:00"),
        at("2026-02-01T00:00"),
        Bucket::Month,
    );
    assert_eq!(months, ["2026-01"]);
}

#[test]
fn ist_midnight_month_rollover_and_exclusive_end() {
    block_on(async {
        let shop = Shop::new().await;
        // 23:59:59.999 IST on 4 March and 00:00:00.000 IST on 5 March, in every stored shape.
        shop.add(order("a1", "2026-03-04T18:29:59.999Z")).await;
        shop.add(order("a2", "2026-03-04T18:29:59+00:00")).await;
        shop.add(order("b1", "2026-03-04T18:30:00.000Z")).await;
        shop.add(order("b2", "2026-03-04T18:30:00+00:00")).await;
        shop.add(order("b3", "2026-03-04 18:30:00")).await;
        // Unreadable timestamps are never in any window and never crash.
        shop.add(order("junk", "not a time")).await;
        let night = filter("2026-03-04T00:00", "2026-03-05T00:00");
        let day = filter("2026-03-05T00:00", "2026-03-06T00:00");
        assert_eq!(summary(&shop, &night).await.orders, 2);
        assert_eq!(summary(&shop, &day).await.orders, 3);
        assert_eq!(numbers(&orders_of(&shop, &night).await), ["a2", "a1"]);

        let span = filter("2026-03-04T00:00", "2026-03-06T00:00");
        let days = sales_series(&shop.db, &admin(), &span, "day")
            .await
            .unwrap()
            .points;
        assert_eq!((days[0].bucket.as_str(), days[0].orders), ("2026-03-04", 2));
        assert_eq!((days[1].bucket.as_str(), days[1].orders), ("2026-03-05", 3));
        let late = filter("2026-03-04T23:00", "2026-03-05T01:00");
        let hours = sales_series(&shop.db, &admin(), &late, "hour")
            .await
            .unwrap()
            .points;
        assert_eq!(
            hours
                .iter()
                .map(|p| (p.bucket.as_str(), p.orders))
                .collect::<Vec<_>>(),
            [("2026-03-04T23:00", 2), ("2026-03-05T00:00", 3)]
        );

        // Minute precision on the end: 09:30 IST is outside [09:00, 09:30).
        shop.add(order("m1", &z("2026-03-10T09:29:59"))).await;
        shop.add(order("m2", &z("2026-03-10T09:30:00"))).await;
        let narrow = filter("2026-03-10T09:00", "2026-03-10T09:30");
        assert_eq!(numbers(&orders_of(&shop, &narrow).await), ["m1"]);

        // Month rollover: 00:00 IST on 1 March belongs to March, one second earlier to February.
        shop.add(order("f1", "2026-02-28T18:29:59.999Z")).await;
        shop.add(order("f2", "2026-02-28T18:30:00.000Z")).await;
        let months = filter("2026-02-01T00:00", "2026-04-02T00:00");
        let points = sales_series(&shop.db, &admin(), &months, "month")
            .await
            .unwrap()
            .points;
        assert_eq!(
            points
                .iter()
                .map(|p| (p.bucket.as_str(), p.orders))
                .collect::<Vec<_>>(),
            [("2026-02", 1), ("2026-03", 8), ("2026-04", 0)]
        );
    });
}

#[test]
fn cancelled_and_voided_money_follow_their_own_dates() {
    block_on(async {
        let shop = Shop::new().await;
        shop.story().await;
        // January: o3 was cancelled later, so it is not billed, but its cash was collected then.
        let j = summary(&shop, &jan()).await;
        assert_eq!(
            (
                j.orders,
                j.net_billed_minor,
                j.gross_minor,
                j.discount_minor
            ),
            (1, 27_000, 30_000, 3_000)
        );
        assert_eq!(
            (j.collected_minor, j.refunded_minor, j.net_collected_minor),
            (32_000, 0, 32_000)
        );
        assert_eq!((j.cancelled_count, j.cancelled_minor), (0, 0));
        assert_eq!((j.expenses_minor, j.profit_minor), (1_500, Some(30_500)));
        // Asking for cancelled orders adds the order, not any money.
        let mut with = jan();
        with.include_cancelled = true;
        let jc = summary(&shop, &with).await;
        assert_eq!(
            (jc.orders, jc.net_billed_minor, jc.collected_minor),
            (2, 32_000, 32_000)
        );
        assert_eq!(
            jc.by_status
                .iter()
                .map(|s| (s.status.as_str(), s.orders))
                .collect::<Vec<_>>(),
            [("cancelled", 1), ("ready", 1)]
        );

        // February: the voided payment is a refund now; the order was cancelled now.
        let f = summary(&shop, &feb()).await;
        assert_eq!((f.orders, f.net_billed_minor), (2, 30_000));
        assert_eq!(
            (f.collected_minor, f.refunded_minor, f.net_collected_minor),
            (30_000, 5_000, 25_000)
        );
        assert_eq!((f.cancelled_count, f.cancelled_minor), (1, 5_000));
        assert_eq!((f.expenses_minor, f.profit_minor), (2_500, Some(22_500)));

        // Splitting at the month boundary loses and double counts nothing.
        let all = summary(&shop, &both()).await;
        assert_eq!(all.collected_minor, j.collected_minor + f.collected_minor);
        assert_eq!(all.refunded_minor, j.refunded_minor + f.refunded_minor);
        assert_eq!(all.net_collected_minor, 57_000);
        assert_eq!(
            all.net_billed_minor,
            j.net_billed_minor + f.net_billed_minor
        );
        assert_eq!((all.cancelled_count, all.cancelled_minor), (1, 5_000));
        // A status filter that leaves out "cancelled" leaves the cancelled card at zero too.
        let mut only_ready = both();
        only_ready.statuses = vec!["ready".into()];
        let r = summary(&shop, &only_ready).await;
        assert_eq!((r.cancelled_count, r.cancelled_minor), (0, 0));
        let mut ready_or_cancelled = both();
        ready_or_cancelled.statuses = vec!["ready".into(), "cancelled".into()];
        let rc = summary(&shop, &ready_or_cancelled).await;
        assert_eq!((rc.cancelled_count, rc.cancelled_minor), (1, 5_000));
        // A payment recorded and voided in the same window nets to zero inside it.
        let day = filter("2026-02-02T00:00", "2026-02-03T00:00");
        let d = summary(&shop, &day).await;
        assert_eq!((d.collected_minor, d.refunded_minor), (0, 5_000));
        // Asking for the cancelled status by name shows cancelled orders without the toggle.
        let mut named = jan();
        named.statuses = vec!["cancelled".into()];
        assert_eq!(numbers(&orders_of(&shop, &named).await), ["o3"]);
    });
}

#[test]
fn a_cancelled_order_without_an_audit_row_falls_back_to_its_last_update() {
    block_on(async {
        let shop = Shop::new().await;
        shop.add(
            order("old", &z("2026-01-10T10:00"))
                .status("cancelled")
                .updated(&plus("2026-01-12T10:00")),
        )
        .await;
        let in_window = summary(&shop, &filter("2026-01-12T00:00", "2026-01-13T00:00")).await;
        assert_eq!(
            (in_window.cancelled_count, in_window.cancelled_minor),
            (1, 10_000)
        );
        let before = summary(&shop, &filter("2026-01-10T00:00", "2026-01-11T00:00")).await;
        assert_eq!(before.cancelled_count, 0);
        let mut f = filter("2026-01-10T00:00", "2026-01-11T00:00");
        f.include_cancelled = true;
        let row = orders_of(&shop, &f).await.items.remove(0);
        assert_eq!(
            row.cancelled_at.as_deref(),
            Some(plus("2026-01-12T10:00").as_str())
        );
    });
}

#[test]
fn transactions_reconcile_with_the_summary() {
    block_on(async {
        let shop = Shop::new().await;
        shop.story().await;
        for f in [jan(), feb(), both()] {
            let s = summary(&shop, &f).await;
            let page = txns_of(&shop, &f).await;
            let paid: i64 = page
                .items
                .iter()
                .filter(|t| t.kind == "payment")
                .map(|t| t.amount_minor)
                .sum();
            let back: i64 = page
                .items
                .iter()
                .filter(|t| t.kind == "refund")
                .map(|t| t.amount_minor)
                .sum();
            assert_eq!(paid, s.collected_minor);
            assert_eq!(back, s.refunded_minor);
            assert_eq!(paid - back, s.net_collected_minor);
            assert_eq!(page.total as usize, page.items.len());
        }
        // The voided payment appears twice, newest event first: the refund, then the original.
        let feb_page = txns_of(&shop, &feb()).await;
        let first = &feb_page.items[0];
        assert_eq!((first.id.as_str(), first.kind.as_str()), ("p4b", "payment"));
        let refund = feb_page.items.iter().find(|t| t.kind == "refund").unwrap();
        assert_eq!((refund.id.as_str(), refund.amount_minor), ("p3", 5_000));
        assert_eq!(refund.at, plus("2026-02-02T11:00"));
        assert_eq!(refund.void_reason.as_deref(), Some("order cancelled"));
        assert_eq!(refund.voided_by_name.as_deref(), Some("Meera Shah"));
        assert_eq!(refund.staff_name.as_deref(), Some("Asha Patil"));
        assert_eq!(
            (refund.order_number.as_str(), refund.order_status.as_str()),
            ("LA-o3", "cancelled")
        );
        assert_eq!(refund.method, "cash");
        let jan_page = txns_of(&shop, &jan()).await;
        assert!(jan_page
            .items
            .iter()
            .any(|t| t.id == "p3" && t.kind == "payment"));
    });
}

#[test]
fn series_always_add_up_to_the_summary() {
    block_on(async {
        let shop = Shop::new().await;
        shop.story().await;
        let mut narrowed = both();
        narrowed.staff_id = Some("staff-1".into());
        let mut cancelled = both();
        cancelled.include_cancelled = true;
        let cases = [
            (both(), "month"),
            (both(), "day"),
            (cancelled, "day"),
            (narrowed, "day"),
            (filter("2026-01-31T00:00", "2026-02-02T00:00"), "hour"),
            (filter("2026-01-31T22:30", "2026-02-01T00:15"), "hour"),
        ];
        for (f, bucket) in cases {
            let s = summary(&shop, &f).await;
            let series = sales_series(&shop.db, &admin(), &f, bucket).await.unwrap();
            let sum = |pick: fn(&SeriesPoint) -> i64| series.points.iter().map(pick).sum::<i64>();
            assert_eq!(sum(|p| p.orders), s.orders, "{bucket} orders");
            assert_eq!(sum(|p| p.pieces), s.pieces, "{bucket} pieces");
            assert_eq!(sum(|p| p.gross_minor), s.gross_minor, "{bucket} gross");
            assert_eq!(
                sum(|p| p.discount_minor),
                s.discount_minor,
                "{bucket} discount"
            );
            assert_eq!(
                sum(|p| p.net_billed_minor),
                s.net_billed_minor,
                "{bucket} net"
            );
            assert_eq!(
                sum(|p| p.collected_minor),
                s.collected_minor,
                "{bucket} collected"
            );
            assert_eq!(
                sum(|p| p.refunded_minor),
                s.refunded_minor,
                "{bucket} refunded"
            );
        }
        let months = sales_series(&shop.db, &admin(), &both(), "month")
            .await
            .unwrap()
            .points;
        assert_eq!(months.len(), 2);
        assert_eq!(
            (months[0].bucket.as_str(), months[0].net_billed_minor),
            ("2026-01", 27_000)
        );
        assert_eq!(
            (months[1].bucket.as_str(), months[1].refunded_minor),
            ("2026-02", 5_000)
        );
    });
}

#[test]
fn legacy_rows_are_shown_once_and_never_crash() {
    block_on(async {
        let shop = Shop::new().await;
        // A legacy user that never became a counter account, an order without pieces or items,
        // the older timestamp shape and the legacy 'credit' payment method.
        sqlx::query("INSERT INTO local_users(id,full_name,pin_hash,pin_salt,role,created_at,updated_at) VALUES('legacy-user','Old Owner','x','x','admin','2025-01-01','2025-01-01')")
            .execute(shop.db.writer_pool().unwrap()).await.unwrap();
        shop.add(
            order("leg", "2026-03-01 04:30:00")
                .status("ready")
                .by("legacy-user")
                .pieces(0)
                .money(45_000, 0),
        )
        .await;
        shop.pay(
            "lp",
            "leg",
            45_000,
            "credit",
            "2026-03-01 04:45:00",
            "legacy-user",
        )
        .await;
        let f = filter("2026-03-01T00:00", "2026-03-02T00:00");
        let s = summary(&shop, &f).await;
        assert_eq!(
            (s.orders, s.pieces, s.net_billed_minor, s.collected_minor),
            (1, 0, 45_000, 45_000)
        );
        assert_eq!(
            s.by_method,
            [MethodBreakdown {
                method: "credit".into(),
                collected_minor: 45_000,
                refunded_minor: 0,
                payments: 1
            }]
        );
        assert_eq!(s.by_staff.len(), 1);
        assert_eq!(
            (s.by_staff[0].staff_id.as_str(), s.by_staff[0].name.clone()),
            ("legacy-user", None)
        );
        assert!(s.by_service.is_empty());
        let row = orders_of(&shop, &f).await.items.remove(0);
        assert_eq!(
            (row.piece_count, row.paid_minor, row.balance_minor),
            (0, 45_000, 0)
        );
        assert_eq!(
            (row.staff_name, row.methods),
            (None, vec!["credit".to_string()])
        );
        let t = txns_of(&shop, &f).await.items.remove(0);
        assert_eq!((t.staff_name, t.method.as_str()), (None, "credit"));
        let series = sales_series(&shop.db, &admin(), &f, "hour").await.unwrap();
        assert_eq!(
            series.points.iter().map(|p| p.collected_minor).sum::<i64>(),
            45_000
        );
        // A legacy order without tracked pieces cannot be collected at the counter, so it is on
        // neither the attention lists nor the queue counts (the two always agree).
        let now = DateTime::parse_from_rfc3339("2026-03-20T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let overview = dashboard_overview_at(&shop.db, &admin(), now)
            .await
            .unwrap();
        assert_eq!(overview.queue.ready, 0);
        assert_eq!(
            (overview.ready_waiting.total, overview.in_process.total),
            (0, 0)
        );
        assert_eq!(overview.recent_orders.len(), 1);
        // Legacy staff are not offered as a filter (no counter account), and cause no failure.
        assert!(sales_staff_options(&shop.db, &admin())
            .await
            .unwrap()
            .is_empty());
    });
}

#[test]
fn search_finds_bill_numbers_names_and_phones_in_any_format() {
    block_on(async {
        let shop = Shop::new().await;
        shop.add(
            order("r", &z("2026-03-05T10:00"))
                .number("LA-2026-00012")
                .customer("Rita Joshi", "9876543210"),
        )
        .await;
        shop.add(
            order("o", &z("2026-03-05T10:01"))
                .number("LA-2026-00013")
                .customer("Om Patil", "9000000001"),
        )
        .await;
        shop.add(
            order("u", &z("2026-03-05T10:02"))
                .number("LA-2026-00014")
                .customer("A_B Store", "9111111111"),
        )
        .await;
        shop.add(
            order("x", &z("2026-03-05T10:03"))
                .number("LA-2026-00015")
                .customer("AXB Store", "9222222222"),
        )
        .await;
        shop.pay(
            "pr",
            "r",
            10_000,
            "cash",
            &plus("2026-03-05T10:05"),
            "staff-1",
        )
        .await;
        shop.pay(
            "po",
            "o",
            10_000,
            "cash",
            &plus("2026-03-05T10:06"),
            "staff-1",
        )
        .await;
        let day = filter("2026-03-05T00:00", "2026-03-06T00:00");
        let find = |text: &'static str| {
            let shop = &shop;
            let mut f = day.clone();
            f.search = Some(text.into());
            async move { numbers(&orders_of(shop, &f).await) }
        };
        assert_eq!(find("00012").await, ["r"]);
        assert_eq!(find("la-2026-00013").await, ["o"]);
        assert_eq!(find("  rita ").await, ["r"]);
        assert_eq!(find("+91 98765 43210").await, ["r"]);
        assert_eq!(find("98765 43210").await, ["r"]);
        assert_eq!(find("(987) 654").await, ["r"]);
        assert_eq!(find("09876543210").await, ["r"]);
        assert_eq!(find("9000").await, ["o"]);
        assert_eq!(find("a_b").await, ["u"]);
        assert!(find("%").await.is_empty());
        assert_eq!(find("store").await, ["x", "u"]);
        assert_eq!(find("").await, ["x", "u", "o", "r"]);
        // The same text narrows money rows through the order they belong to.
        let mut f = day.clone();
        f.search = Some("rita".into());
        let page = txns_of(&shop, &f).await;
        assert_eq!(
            page.items.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(),
            ["pr"]
        );
        let s = summary(&shop, &f).await;
        assert_eq!(
            (s.orders, s.collected_minor, s.profit_minor),
            (1, 10_000, None)
        );
    });
}

#[test]
fn filters_narrow_orders_and_money_consistently() {
    block_on(async {
        let shop = Shop::new().await;
        shop.story().await;
        let with = |change: &dyn Fn(&mut SalesFilter)| {
            let mut f = both();
            change(&mut f);
            f
        };
        let discounted = with(&|f| f.discounted_only = true);
        assert_eq!(numbers(&orders_of(&shop, &discounted).await), ["o1"]);
        let s = summary(&shop, &discounted).await;
        assert_eq!(
            (s.orders, s.collected_minor, s.profit_minor),
            (1, 27_000, None)
        );

        let ready = with(&|f| f.statuses = vec!["ready".into()]);
        assert_eq!(numbers(&orders_of(&shop, &ready).await), ["o1"]);
        assert_eq!(summary(&shop, &ready).await.collected_minor, 27_000);

        let upi = with(&|f| f.payment_methods = vec!["upi".into()]);
        assert_eq!(numbers(&orders_of(&shop, &upi).await), ["o2"]);
        let s = summary(&shop, &upi).await;
        assert_eq!((s.collected_minor, s.refunded_minor), (10_000, 0));
        assert_eq!(s.by_method.len(), 1);
        let cash = with(&|f| {
            f.payment_methods = vec!["cash".into(), "cash".into()];
            f.include_cancelled = true;
        });
        let s = summary(&shop, &cash).await;
        assert_eq!(
            (s.collected_minor, s.refunded_minor),
            (27_000 + 5_000 + 12_000, 5_000)
        );
        assert_eq!(
            numbers(&orders_of(&shop, &cash).await).len(),
            3,
            "o1, o3 and o4 each have a cash payment"
        );

        // Billed follows the creator, money follows whoever took the payment (refunds too).
        let feb_staff = |id: &str| {
            let mut f = feb();
            f.staff_id = Some(id.into());
            f
        };
        let asha = summary(&shop, &feb_staff("staff-1")).await;
        assert_eq!(
            (asha.orders, asha.net_billed_minor, asha.collected_minor),
            (0, 0, 12_000)
        );
        assert_eq!(
            asha.refunded_minor, 5_000,
            "Asha took the cash that was handed back"
        );
        let ravi = summary(&shop, &feb_staff("staff-2")).await;
        assert_eq!(
            (ravi.orders, ravi.net_billed_minor, ravi.collected_minor),
            (2, 30_000, 18_000)
        );
        assert_eq!(ravi.refunded_minor, 0);
        let both_staff: i64 = asha.collected_minor + ravi.collected_minor;
        assert_eq!(both_staff, summary(&shop, &feb()).await.collected_minor);
        let nobody = summary(&shop, &feb_staff("ghost")).await;
        assert_eq!((nobody.orders, nobody.collected_minor), (0, 0));
        let mut blank = feb();
        blank.staff_id = Some("   ".into());
        assert_eq!(summary(&shop, &blank).await.orders, 2);

        // Staff breakdown over the whole window joins both views by account.
        let by = summary(&shop, &both()).await.by_staff;
        let asha = by.iter().find(|s| s.staff_id == "staff-1").unwrap();
        assert_eq!(asha.name.as_deref(), Some("Asha Patil"));
        assert_eq!(
            (
                asha.orders,
                asha.net_billed_minor,
                asha.collected_minor,
                asha.refunded_minor
            ),
            (1, 27_000, 44_000, 5_000)
        );
        let ravi = by.iter().find(|s| s.staff_id == "staff-2").unwrap();
        assert_eq!(
            (ravi.orders, ravi.net_billed_minor, ravi.collected_minor),
            (2, 30_000, 18_000)
        );
    });
}

#[test]
fn breakdowns_by_method_status_and_service() {
    block_on(async {
        let shop = Shop::new().await;
        shop.story().await;
        let s = summary(&shop, &feb()).await;
        assert_eq!(
            s.by_method
                .iter()
                .map(|m| (
                    m.method.as_str(),
                    m.collected_minor,
                    m.refunded_minor,
                    m.payments
                ))
                .collect::<Vec<_>>(),
            [
                ("cash", 12_000, 5_000, 1),
                ("upi", 10_000, 0, 1),
                ("card", 8_000, 0, 1)
            ]
        );
        assert_eq!(
            s.by_status
                .iter()
                .map(|b| (b.status.as_str(), b.orders, b.net_billed_minor))
                .collect::<Vec<_>>(),
            [("collected", 2, 30_000)]
        );
        assert_eq!(
            s.by_service
                .iter()
                .map(|b| (b.service.as_str(), b.pieces, b.amount_minor))
                .collect::<Vec<_>>(),
            [("Dry Clean", 3, 20_000), ("Iron", 1, 10_000)]
        );
        assert_eq!((s.pieces, s.average_order_minor), (4, 15_000));
        let j = summary(&shop, &jan()).await;
        assert_eq!(j.by_service[0].service, "Wash + Iron");
        assert_eq!(
            (j.by_service[0].pieces, j.by_service[0].amount_minor),
            (2, 30_000),
            "services show the amount before discount"
        );
    });
}

#[test]
fn the_average_order_rounds_to_the_nearest_paise() {
    block_on(async {
        let shop = Shop::new().await;
        shop.add(order("a", &z("2026-03-05T10:00")).money(10_001, 0))
            .await;
        shop.add(order("b", &z("2026-03-05T10:01")).money(10_000, 0))
            .await;
        let s = summary(&shop, &filter("2026-03-05T00:00", "2026-03-06T00:00")).await;
        assert_eq!(s.average_order_minor, 10_001, "10000.5 rounds up");
    });
}

#[test]
fn order_rows_report_balance_methods_and_cancellation() {
    block_on(async {
        let shop = Shop::new().await;
        shop.story().await;
        shop.add(
            order("part", &z("2026-02-15T10:00"))
                .status("ready")
                .money(9_000, 0)
                .pieces(0),
        )
        .await;
        shop.pay(
            "pp",
            "part",
            4_000,
            "upi",
            &plus("2026-02-15T10:05"),
            "staff-1",
        )
        .await;
        shop.pay(
            "pq",
            "part",
            1_000,
            "cash",
            &plus("2026-02-15T10:06"),
            "staff-1",
        )
        .await;
        let mut f = both();
        f.include_cancelled = true;
        let page = orders_of(&shop, &f).await;
        let row = |id: &str| page.items.iter().find(|r| r.id == id).unwrap().clone();
        let part = row("part");
        assert_eq!(
            (part.total_minor, part.paid_minor, part.balance_minor),
            (9_000, 5_000, 4_000)
        );
        assert_eq!(part.methods, ["cash", "upi"]);
        let cancelled = row("o3");
        assert_eq!((cancelled.paid_minor, cancelled.balance_minor), (0, 0));
        assert_eq!(cancelled.methods, ["cash"]);
        assert_eq!(
            cancelled.cancelled_at.as_deref(),
            Some(plus("2026-02-02T11:00").as_str())
        );
        assert_eq!(row("o1").cancelled_at, None);
        assert_eq!(
            (
                row("o1").gross_minor,
                row("o1").discount_minor,
                row("o1").total_minor
            ),
            (30_000, 3_000, 27_000)
        );
        assert_eq!(row("o1").piece_count, 2);
        assert_eq!(row("o1").staff_name.as_deref(), Some("Asha Patil"));
        assert_eq!(row("o1").staff_id.as_deref(), Some("staff-1"));
        // Newest first by the real instant.
        assert_eq!(numbers(&page), ["part", "o4", "o2", "o1", "o3"]);
    });
}

#[test]
fn pagination_is_stable_when_rows_share_a_timestamp() {
    block_on(async {
        let shop = Shop::new().await;
        for index in 0..25 {
            let id = format!("same-{index:02}");
            shop.add(order(&id, "2026-03-05T05:00:00.000Z")).await;
            shop.pay(
                &format!("pay-{index:02}"),
                &id,
                1_000,
                "cash",
                "2026-03-05T05:30:00+00:00",
                "staff-1",
            )
            .await;
        }
        let f = filter("2026-03-05T00:00", "2026-03-06T00:00");
        let all = sales_orders(&shop.db, &admin(), &f, 0, 100).await.unwrap();
        assert_eq!(all.total, 25);
        let mut paged = Vec::new();
        for offset in [0, 10, 20] {
            let page = sales_orders(&shop.db, &admin(), &f, offset, 10)
                .await
                .unwrap();
            assert_eq!(page.total, 25);
            paged.extend(numbers(&page));
        }
        assert_eq!(paged, numbers(&all));
        let mut unique = paged.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(unique.len(), 25);
        assert!(sales_orders(&shop.db, &admin(), &f, 25, 10)
            .await
            .unwrap()
            .items
            .is_empty());

        let all = sales_transactions(&shop.db, &admin(), &f, 0, 100)
            .await
            .unwrap();
        assert_eq!(all.total, 25);
        let mut paged = Vec::new();
        for offset in [0, 7, 14, 21] {
            paged.extend(
                sales_transactions(&shop.db, &admin(), &f, offset, 7)
                    .await
                    .unwrap()
                    .items
                    .into_iter()
                    .map(|t| t.id),
            );
        }
        assert_eq!(
            paged,
            all.items.iter().map(|t| t.id.clone()).collect::<Vec<_>>()
        );
    });
}

#[test]
fn expenses_are_dated_by_day() {
    block_on(async {
        let shop = Shop::new().await;
        shop.expense("a", "2026-03-04", 100).await;
        shop.expense("b", "2026-03-05", 200).await;
        shop.expense("c", "2026-03-06T08:00:00.000Z", 400).await;
        let at = |from: &str, to: &str| {
            let (shop, f) = (&shop, filter(from, to));
            async move { summary(shop, &f).await.expenses_minor }
        };
        assert_eq!(
            at("2026-03-05T00:00", "2026-03-06T00:00").await,
            200,
            "a whole day"
        );
        assert_eq!(
            at("2026-03-05T09:00", "2026-03-05T18:00").await,
            200,
            "part of a day counts the day"
        );
        assert_eq!(at("2026-03-04T12:00", "2026-03-06T00:00").await, 300);
        assert_eq!(at("2026-03-05T23:59", "2026-03-06T00:01").await, 600);
        assert_eq!(at("2026-03-01T00:00", "2026-03-04T00:00").await, 0);
        let s = summary(&shop, &filter("2026-03-05T00:00", "2026-03-06T00:00")).await;
        assert_eq!(
            s.profit_minor,
            Some(-200),
            "no money collected, one expense"
        );
        let mut narrowed = filter("2026-03-05T00:00", "2026-03-06T00:00");
        narrowed.statuses = vec!["ready".into()];
        let s = summary(&shop, &narrowed).await;
        assert_eq!((s.expenses_minor, s.profit_minor), (200, None));
    });
}

#[test]
fn staff_options_list_only_people_with_sales_by_name_alone() {
    block_on(async {
        let shop = Shop::new().await;
        shop.account("staff-3", "Zoya Idle", "staff", true).await;
        shop.account("staff-4", "old hand", "staff", false).await;
        shop.add(order("a", &z("2026-03-05T10:00")).by("staff-2"))
            .await;
        shop.pay(
            "pa",
            "a",
            1_000,
            "cash",
            &plus("2026-03-05T10:05"),
            "staff-4",
        )
        .await;
        let options = sales_staff_options(&shop.db, &staff()).await.unwrap();
        assert_eq!(
            options
                .iter()
                .map(|o| o.full_name.as_str())
                .collect::<Vec<_>>(),
            ["old hand", "Ravi Kulkarni"]
        );
        let keys: Vec<String> = serde_json::to_value(&options[0])
            .unwrap()
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect();
        assert_eq!(keys, ["fullName", "id"]);
    });
}

#[test]
fn the_dashboard_lists_what_needs_attention() {
    block_on(async {
        let shop = Shop::new().await;
        // 15 March 2026, 12:00 IST.
        let now = DateTime::parse_from_rfc3339("2026-03-15T06:30:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let ready = |id: &str, hours: &str| {
            order(id, &z("2026-03-01T10:00"))
                .status("ready")
                .updated(&plus(hours))
                .by("staff-1")
                .customer(id, "9990000000")
        };
        // Became ready 3 days ago (audit says so, even though a later payment touched the row).
        shop.add(ready("r-old", "2026-03-14T12:00")).await;
        shop.audit("order_status_changed", "r-old", &plus("2026-03-12T10:00"))
            .await;
        shop.audit("order_status_changed", "r-old", &plus("2026-03-12T11:00"))
            .await;
        // Ready only 1 day ago: not yet a problem.
        shop.add(ready("r-new", "2026-03-14T11:00")).await;
        shop.audit("order_status_changed", "r-new", &plus("2026-03-14T11:00"))
            .await;
        // No audit row: falls back to the update time, which is old.
        shop.add(ready("r-legacyish", "2026-03-10T09:00")).await;
        // Exactly 2 days ago to the second counts as waiting that long.
        shop.add(ready("r-edge", "2026-03-14T00:00")).await;
        shop.audit("order_status_changed", "r-edge", &plus("2026-03-13T12:00"))
            .await;
        // Piece-less legacy order is ignored by the list and by the queue counts alike.
        shop.add(ready("r-nopieces", "2026-03-01T09:00").pieces(0))
            .await;
        shop.pay(
            "pay-old",
            "r-old",
            4_000,
            "cash",
            &plus("2026-03-01T10:30"),
            "staff-1",
        )
        .await;

        shop.add(
            order("w-late", &z("2026-03-10T10:00"))
                .status("washing")
                .promised(&z("2026-03-13T17:00")),
        )
        .await;
        shop.add(
            order("w-soon", &z("2026-03-14T10:00"))
                .status("received")
                .promised(&z("2026-03-16T17:00")),
        )
        .await;
        shop.add(
            order("w-none", &z("2026-03-14T11:00"))
                .status("packing")
                .pieces(2),
        )
        .await;
        shop.add(
            order("w-nopieces", &z("2026-03-14T11:00"))
                .status("washing")
                .pieces(0),
        )
        .await;
        shop.add(order("done", &z("2026-03-14T11:00"))).await;
        shop.run("INSERT INTO inventory_items(id,name,current_quantity,unit,minimum_quantity,created_at,updated_at,origin_device_id) VALUES('i1','Soap',1,'kg',2,'2026-01-01','2026-01-01','t'),('i2','Bags',5,'pcs',2,'2026-01-01','2026-01-01','t'),('i3','Pegs',2,'pcs',2,'2026-01-01','2026-01-01','t'),('i4','Hangers',0,'pcs',0,'2026-01-01','2026-01-01','t')").await;

        let overview = dashboard_overview_at(&shop.db, &staff(), now)
            .await
            .unwrap();
        assert_eq!(overview.generated_at, "2026-03-15T06:30:00.000Z");
        assert_eq!(
            (
                overview.today_date.as_str(),
                overview.month_start_date.as_str()
            ),
            ("2026-03-15", "2026-03-01")
        );
        // The two piece-less legacy orders are in neither the lists nor these counts.
        assert_eq!(
            overview.queue,
            QueueCounts {
                received: 1,
                in_process: 2,
                ready: 4
            }
        );
        let waiting = &overview.ready_waiting;
        assert_eq!(waiting.total, 3);
        assert_eq!(
            waiting
                .orders
                .iter()
                .map(|o| o.id.as_str())
                .collect::<Vec<_>>(),
            ["r-legacyish", "r-old", "r-edge"]
        );
        assert_eq!(
            waiting
                .orders
                .iter()
                .map(|o| o.days_waiting)
                .collect::<Vec<_>>(),
            [5, 3, 2]
        );
        assert_eq!(waiting.orders[1].since_at, plus("2026-03-12T11:00"));
        assert_eq!(
            (
                waiting.orders[1].balance_minor,
                waiting.orders[1].piece_count,
                waiting.orders[1].overdue
            ),
            (6_000, 1, false)
        );
        let working = &overview.in_process;
        assert_eq!(working.total, 3);
        assert_eq!(
            working
                .orders
                .iter()
                .map(|o| o.id.as_str())
                .collect::<Vec<_>>(),
            ["w-late", "w-soon", "w-none"]
        );
        assert_eq!(
            working.orders.iter().map(|o| o.overdue).collect::<Vec<_>>(),
            [true, false, false]
        );
        assert_eq!(working.orders[0].days_waiting, 5);
        assert_eq!(working.orders[2].promised_at, None);
        assert_eq!(overview.low_stock_count, 2);
        // Recent orders: newest first, capped at 8, nothing hidden by status.
        assert_eq!(overview.recent_orders.len(), 8);
        assert_eq!(
            overview.recent_orders[..3]
                .iter()
                .map(|o| o.id.as_str())
                .collect::<Vec<_>>(),
            ["w-nopieces", "w-none", "done"],
            "newest first; orders created at the same moment break ties by id"
        );
        let times: Vec<_> = overview
            .recent_orders
            .iter()
            .map(|o| o.received_at.clone())
            .collect();
        let mut sorted = times.clone();
        sorted.sort_by(|a, b| b.cmp(a));
        assert_eq!(times, sorted);
    });
}

#[test]
fn dashboard_cards_use_shop_midnight_and_month_start() {
    block_on(async {
        let shop = Shop::new().await;
        // 1 April 2026, 00:30 IST = 31 March 19:00 UTC.
        let now = DateTime::parse_from_rfc3339("2026-03-31T19:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        shop.add(order("late-march", &z("2026-03-31T23:59")).money(10_000, 0))
            .await;
        shop.add(order("early-april", &z("2026-04-01T00:10")).money(5_000, 0))
            .await;
        shop.pay(
            "pm",
            "early-april",
            5_000,
            "cash",
            &plus("2026-04-01T00:12"),
            "staff-1",
        )
        .await;
        let overview = dashboard_overview_at(&shop.db, &admin(), now)
            .await
            .unwrap();
        assert_eq!(overview.today_date, "2026-04-01");
        assert_eq!(
            (
                overview.today.orders,
                overview.today.net_billed_minor,
                overview.today.collected_minor
            ),
            (1, 5_000, 5_000)
        );
        assert_eq!(
            (
                overview.month_to_date.orders,
                overview.month_to_date.net_billed_minor
            ),
            (1, 5_000)
        );
        // The same shop one hour earlier is still 31 March.
        let earlier = now - Duration::hours(1);
        let overview = dashboard_overview_at(&shop.db, &admin(), earlier)
            .await
            .unwrap();
        assert_eq!(
            (
                overview.today_date.as_str(),
                overview.month_start_date.as_str()
            ),
            ("2026-03-31", "2026-03-01")
        );
        assert_eq!(overview.today.orders, 1);
        // "Month to date" ends at the coming midnight, so 23:59 tonight is already inside it.
        assert_eq!(overview.month_to_date.orders, 1);
    });
}

#[test]
fn the_search_text_helper_handles_phone_prefixes_and_wildcards() {
    assert_eq!(search_patterns(None).unwrap(), (None, None));
    assert_eq!(search_patterns(Some("   ")).unwrap(), (None, None));
    let (name, phone) = search_patterns(Some("Rita")).unwrap();
    assert_eq!(
        (name.as_deref(), phone.as_deref()),
        (Some("%Rita%"), Some("%Rita%"))
    );
    let (_, phone) = search_patterns(Some("+91 98765-43210")).unwrap();
    assert_eq!(phone.as_deref(), Some("%9876543210%"));
    let (_, phone) = search_patterns(Some("12")).unwrap();
    assert_eq!(
        phone.as_deref(),
        Some("%12%"),
        "two digits are too short to count as a phone number"
    );
    let (name, _) = search_patterns(Some("50%_off")).unwrap();
    assert_eq!(name.as_deref(), Some("%50\\%\\_off%"));
    assert!(search_patterns(Some(&"y".repeat(101))).is_err());
    assert!(search_patterns(Some(&"y".repeat(100))).is_ok());
    // Devanagari digits search like ASCII digits.
    let (_, phone) = search_patterns(Some("९८७६५")).unwrap();
    assert_eq!(phone.as_deref(), Some("%98765%"));
}

#[test]
fn results_serialize_with_camel_case_keys() {
    block_on(async {
        let shop = Shop::new().await;
        shop.story().await;
        let value: Value = serde_json::to_value(summary(&shop, &feb()).await).unwrap();
        for key in [
            "netBilledMinor",
            "netCollectedMinor",
            "cancelledCount",
            "profitMinor",
            "byMethod",
            "byStaff",
            "averageOrderMinor",
        ] {
            assert!(value.get(key).is_some(), "{key}");
        }
        let filter: SalesFilter = serde_json::from_value(json!({
            "from": "2026-01-01T00:00", "to": "2026-01-02T00:00",
            "paymentMethods": ["cash"], "statuses": ["ready"], "staffId": "s", "search": "x",
            "discountedOnly": true, "includeCancelled": true
        }))
        .unwrap();
        assert_eq!(
            (
                filter.payment_methods.len(),
                filter.discounted_only,
                filter.include_cancelled
            ),
            (1, true, true)
        );
        let minimal: SalesFilter = serde_json::from_value(json!({"from": "a", "to": "b"})).unwrap();
        assert!(
            minimal.statuses.is_empty() && minimal.staff_id.is_none() && !minimal.include_cancelled
        );
    });
}

/// Names of the indexes SQLite plans to use for the billed-orders query.
async fn plan_of(shop: &Shop, scope: &Scope) -> String {
    let sql = format!(
        "EXPLAIN QUERY PLAN SELECT COUNT(*) FROM orders o WHERE {}",
        scope.order_where()
    );
    let rows = bind_scope(sqlx::query(&sql), scope)
        .fetch_all(shop.db.writer_pool().unwrap())
        .await
        .unwrap();
    rows.iter()
        .map(|r| r.try_get::<String, _>("detail").unwrap())
        .collect::<Vec<_>>()
        .join(" | ")
}

async fn bulk_load(shop: &Shop, orders: u32) {
    // One generated month per ~3,300 orders, spread over the days, with a payment for each.
    shop.run(&format!(
        "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < {orders}) \
         INSERT INTO orders(id,order_number,customer_name,customer_phone,order_type,received_at,status,subtotal,discount_amount,total_amount,created_by,created_at,updated_at,origin_device_id) \
         SELECT 'bulk-'||i, 'LA-'||i, 'Customer '||i, '9'||printf('%09d', i), 'piece', \
                strftime('%Y-%m-%dT%H:%M:%S', 1735689600 + (i % 700) * 86400 + (i % 86400), 'unixepoch')||'.000Z', \
                CASE i % 5 WHEN 0 THEN 'ready' ELSE 'collected' END, 100.0, 0.0, 100.0, 'staff-1', 'x', 'x', 't' FROM n"
    ))
    .await;
    shop.run(
        "INSERT INTO payments(id,order_id,amount,method,recorded_at,recorded_by,created_at,updated_at,origin_device_id) \
         SELECT 'pay-'||id, id, 100.0, 'cash', replace(received_at, '.000Z', '+00:00'), 'staff-1', 'x', 'x', 't' FROM orders WHERE id LIKE 'bulk-%'",
    )
    .await;
}

#[test]
fn the_billed_orders_query_walks_the_received_at_index() {
    block_on(async {
        let shop = Shop::new().await;
        bulk_load(&shop, 5_000).await;
        shop.run("ANALYZE").await;
        let scope = Scope::parse(&filter("2026-03-01T00:00", "2026-03-08T00:00")).unwrap();
        let plan = plan_of(&shop, &scope).await;
        assert!(plan.contains("idx_orders_received_at"), "plan was: {plan}");
        let s = summary(&shop, &filter("2026-03-01T00:00", "2026-03-08T00:00")).await;
        assert!(s.orders > 0);
        assert_eq!(
            s.collected_minor, s.net_billed_minor,
            "every bulk order is paid in full at creation"
        );
    });
}

/// Manual timing check for a busy shop: `cargo test insights_at_scale -- --ignored --nocapture`.
#[test]
#[ignore]
fn insights_at_scale() {
    block_on(async {
        let shop = Shop::new().await;
        bulk_load(&shop, 100_000).await;
        shop.run("INSERT INTO counter_audit(id,actor_id,action,entity_type,entity_id,details_json,created_at) SELECT 'a-'||id, 'staff-1', 'order_saved', 'order', id, '{}', received_at FROM orders").await;
        shop.run("INSERT INTO order_items(id,order_id,item_name,service_name,service_type,quantity,rate,line_total,created_at,line_total_minor) SELECT 'item-'||id, id, 'Shirt', 'Wash', 'piece', 1, 100.0, 100.0, 'x', 10000 FROM orders").await;
        let timed = |label: &'static str, started: std::time::Instant| {
            println!("{label}: {:?}", started.elapsed());
        };
        let month = filter("2026-03-01T00:00", "2026-04-01T00:00");
        let year = filter("2025-04-01T00:00", "2026-04-01T00:00");
        let t = std::time::Instant::now();
        let s = summary(&shop, &month).await;
        timed("summary (month)", t);
        println!("  orders in March: {}", s.orders);
        let t = std::time::Instant::now();
        summary(&shop, &year).await;
        timed("summary (year)", t);
        let t = std::time::Instant::now();
        sales_series(&shop.db, &admin(), &month, "day")
            .await
            .unwrap();
        timed("series day (month)", t);
        let t = std::time::Instant::now();
        sales_orders(&shop.db, &admin(), &month, 0, 50)
            .await
            .unwrap();
        timed("orders page", t);
        let t = std::time::Instant::now();
        sales_transactions(&shop.db, &admin(), &month, 0, 50)
            .await
            .unwrap();
        timed("transactions page", t);
        let t = std::time::Instant::now();
        dashboard_overview_at(&shop.db, &admin(), Utc::now())
            .await
            .unwrap();
        timed("dashboard", t);
    });
}

// ---------------------------------------------------------------------------------------------
// Advance and balance
// ---------------------------------------------------------------------------------------------

impl Shop {
    /// A payment of the given kind: `pay` writes the default (`settlement`), so set `advance` after.
    #[allow(clippy::too_many_arguments)] // a test helper that mirrors the columns it writes
    async fn pay_kind(
        &self,
        id: &str,
        order_id: &str,
        minor: i64,
        method: &str,
        at: &str,
        by: &str,
        kind: &str,
    ) {
        self.pay(id, order_id, minor, method, at, by).await;
        sqlx::query("UPDATE payments SET kind=? WHERE id=?")
            .bind(kind)
            .bind(id)
            .execute(self.db.writer_pool().unwrap())
            .await
            .unwrap();
    }

    /// A ₹100 order booked on 10 March with a ₹30 cash advance and a ₹70 UPI balance on 12 March.
    async fn advance_story(&self) {
        self.add(order("a1", &z("2026-03-10T10:00")).status("collected"))
            .await;
        self.pay_kind(
            "adv",
            "a1",
            3_000,
            "cash",
            &z("2026-03-10T10:00"),
            "staff-1",
            "advance",
        )
        .await;
        self.pay_kind(
            "bal",
            "a1",
            7_000,
            "upi",
            &plus("2026-03-12T15:00"),
            "staff-2",
            "settlement",
        )
        .await;
    }
}

fn march(from_day: u32, to_day: u32) -> SalesFilter {
    filter(
        &format!("2026-03-{from_day:02}T00:00"),
        &format!("2026-03-{to_day:02}T00:00"),
    )
}

#[test]
fn collected_money_splits_into_advance_and_balance_by_the_day_each_was_taken() {
    block_on(async {
        let shop = Shop::new().await;
        shop.advance_story().await;

        let booked = summary(&shop, &march(10, 11)).await;
        assert_eq!(
            (
                booked.advance_collected_minor,
                booked.balance_collected_minor
            ),
            (3_000, 0)
        );
        assert_eq!(booked.collected_minor, 3_000);

        let settled = summary(&shop, &march(12, 13)).await;
        assert_eq!(
            (
                settled.advance_collected_minor,
                settled.balance_collected_minor
            ),
            (0, 7_000)
        );

        let whole = summary(&shop, &march(10, 13)).await;
        assert_eq!(
            (whole.advance_collected_minor, whole.balance_collected_minor),
            (3_000, 7_000)
        );
        assert_eq!(
            whole.collected_minor,
            whole.advance_collected_minor + whole.balance_collected_minor
        );
        assert_eq!(whole.refunded_minor, 0);
        assert_eq!(
            (whole.advance_refunded_minor, whole.balance_refunded_minor),
            (0, 0)
        );
    });
}

#[test]
fn series_points_carry_the_split_and_add_up_to_collected() {
    block_on(async {
        let shop = Shop::new().await;
        shop.advance_story().await;
        let series = sales_series(&shop.db, &admin(), &march(10, 13), "day")
            .await
            .unwrap();
        let point = |day: &str| {
            series
                .points
                .iter()
                .find(|p| p.bucket == day)
                .unwrap_or_else(|| panic!("no bucket {day}"))
        };
        let tenth = point("2026-03-10");
        assert_eq!(
            (tenth.advance_collected_minor, tenth.balance_collected_minor),
            (3_000, 0)
        );
        assert_eq!(tenth.collected_minor, 3_000);
        let twelfth = point("2026-03-12");
        assert_eq!(
            (
                twelfth.advance_collected_minor,
                twelfth.balance_collected_minor
            ),
            (0, 7_000)
        );
        assert_eq!(twelfth.collected_minor, 7_000);
        let eleventh = point("2026-03-11");
        assert_eq!(
            (
                eleventh.advance_collected_minor,
                eleventh.balance_collected_minor,
                eleventh.collected_minor
            ),
            (0, 0, 0)
        );
        for p in &series.points {
            assert_eq!(
                p.collected_minor,
                p.advance_collected_minor + p.balance_collected_minor
            );
            assert_eq!(
                p.refunded_minor,
                p.advance_refunded_minor + p.balance_refunded_minor
            );
        }
    });
}

#[test]
fn a_refund_is_attributed_to_the_kind_of_the_payment_handed_back() {
    block_on(async {
        let shop = Shop::new().await;
        shop.advance_story().await;
        // The order is cancelled on 14 March and both payments are handed back that day.
        shop.run("UPDATE orders SET status='cancelled' WHERE id='a1'")
            .await;
        shop.void("adv", &plus("2026-03-14T09:00")).await;
        shop.void("bal", &plus("2026-03-14T09:00")).await;

        let day = summary(&shop, &march(14, 15)).await;
        assert_eq!(
            (day.advance_collected_minor, day.balance_collected_minor),
            (0, 0)
        );
        assert_eq!(
            (day.advance_refunded_minor, day.balance_refunded_minor),
            (3_000, 7_000)
        );
        assert_eq!(day.refunded_minor, 10_000);

        // Money taken earlier still counts when it was taken; the UI nets it per kind.
        let earlier = summary(&shop, &march(10, 13)).await;
        assert_eq!(
            (
                earlier.advance_collected_minor,
                earlier.balance_collected_minor
            ),
            (3_000, 7_000)
        );
        let series = sales_series(&shop.db, &admin(), &march(14, 15), "day")
            .await
            .unwrap();
        let point = series
            .points
            .iter()
            .find(|p| p.bucket == "2026-03-14")
            .unwrap();
        assert_eq!(
            (point.advance_refunded_minor, point.balance_refunded_minor),
            (3_000, 7_000)
        );
    });
}

#[test]
fn the_split_follows_the_same_filters_as_collected() {
    block_on(async {
        let shop = Shop::new().await;
        shop.advance_story().await;

        let mut upi = march(10, 13);
        upi.payment_methods = vec!["upi".into()];
        let by_method = summary(&shop, &upi).await;
        assert_eq!(
            (
                by_method.advance_collected_minor,
                by_method.balance_collected_minor
            ),
            (0, 7_000)
        );
        assert_eq!(by_method.collected_minor, 7_000);

        let mut ravi = march(10, 13);
        ravi.staff_id = Some("staff-2".into());
        let by_staff = summary(&shop, &ravi).await;
        assert_eq!(
            (
                by_staff.advance_collected_minor,
                by_staff.balance_collected_minor
            ),
            (0, 7_000)
        );
        assert_eq!(by_staff.collected_minor, 7_000);

        let mut asha = march(10, 13);
        asha.staff_id = Some("staff-1".into());
        let by_other = summary(&shop, &asha).await;
        assert_eq!(
            (
                by_other.advance_collected_minor,
                by_other.balance_collected_minor
            ),
            (3_000, 0)
        );
    });
}

#[test]
fn the_dashboard_carries_the_split_for_today_and_the_month() {
    block_on(async {
        let shop = Shop::new().await;
        shop.advance_story().await;
        // 12 March, 4 pm IST: the balance came in today, the advance earlier this month.
        let now = DateTime::parse_from_rfc3339("2026-03-12T10:30:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let overview = dashboard_overview_at(&shop.db, &admin(), now)
            .await
            .unwrap();
        assert_eq!(
            (
                overview.today.advance_collected_minor,
                overview.today.balance_collected_minor
            ),
            (0, 7_000)
        );
        assert_eq!(
            (
                overview.month_to_date.advance_collected_minor,
                overview.month_to_date.balance_collected_minor
            ),
            (3_000, 7_000)
        );
    });
}

#[test]
fn receivable_counts_what_open_orders_still_owe() {
    block_on(async {
        let shop = Shop::new().await;
        // Owes 70: ready, ₹100 order with a ₹30 advance.
        shop.add(order("r1", &z("2026-03-10T10:00")).status("ready"))
            .await;
        shop.pay_kind(
            "r1p",
            "r1",
            3_000,
            "cash",
            &z("2026-03-10T10:00"),
            "staff-1",
            "advance",
        )
        .await;
        // Owes 50: in process, nothing paid yet.
        shop.add(
            order("r2", &z("2026-03-10T11:00"))
                .status("washing")
                .money(5_000, 0),
        )
        .await;
        // Not owed: fully paid, cancelled, collected, and a legacy order that has no pieces.
        shop.add(order("r3", &z("2026-03-10T12:00")).status("ready"))
            .await;
        shop.pay_kind(
            "r3p",
            "r3",
            10_000,
            "cash",
            &z("2026-03-10T12:00"),
            "staff-1",
            "advance",
        )
        .await;
        shop.add(order("r4", &z("2026-03-10T13:00")).status("cancelled"))
            .await;
        shop.add(order("r5", &z("2026-03-10T14:00")).status("collected"))
            .await;
        shop.add(
            order("r6", &z("2026-03-10T15:00"))
                .status("ready")
                .pieces(0),
        )
        .await;
        // A voided payment does not count as money received.
        shop.add(
            order("r7", &z("2026-03-10T16:00"))
                .status("received")
                .money(2_000, 0),
        )
        .await;
        shop.pay_kind(
            "r7p",
            "r7",
            2_000,
            "cash",
            &z("2026-03-10T16:00"),
            "staff-1",
            "advance",
        )
        .await;
        shop.void("r7p", &plus("2026-03-10T17:00")).await;

        let now = DateTime::parse_from_rfc3339("2026-03-12T10:30:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let overview = dashboard_overview_at(&shop.db, &admin(), now)
            .await
            .unwrap();
        assert_eq!(overview.receivable.orders, 3, "r1, r2 and r7 owe money");
        assert_eq!(overview.receivable.minor, 7_000 + 5_000 + 2_000);
    });
}

#[test]
fn receivable_is_zero_when_nothing_is_owed_and_rounds_each_order_on_its_own() {
    block_on(async {
        let shop = Shop::new().await;
        let now = DateTime::parse_from_rfc3339("2026-03-12T10:30:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let empty = dashboard_overview_at(&shop.db, &admin(), now)
            .await
            .unwrap();
        assert_eq!((empty.receivable.orders, empty.receivable.minor), (0, 0));

        // ₹66.66 paid as two payments of ₹33.33 leaves nothing owed, with no float drift.
        shop.add(
            order("p1", &z("2026-03-10T10:00"))
                .status("ready")
                .money(6_666, 0),
        )
        .await;
        shop.pay_kind(
            "p1a",
            "p1",
            3_333,
            "cash",
            &z("2026-03-10T10:00"),
            "staff-1",
            "advance",
        )
        .await;
        shop.pay_kind(
            "p1b",
            "p1",
            3_333,
            "cash",
            &plus("2026-03-11T10:00"),
            "staff-1",
            "settlement",
        )
        .await;
        let settled = dashboard_overview_at(&shop.db, &admin(), now)
            .await
            .unwrap();
        assert_eq!(
            (settled.receivable.orders, settled.receivable.minor),
            (0, 0)
        );
    });
}

#[test]
fn the_new_figures_use_the_names_the_interface_reads() {
    block_on(async {
        let shop = Shop::new().await;
        shop.advance_story().await;
        let now = DateTime::parse_from_rfc3339("2026-03-12T10:30:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let overview = serde_json::to_value(
            dashboard_overview_at(&shop.db, &admin(), now)
                .await
                .unwrap(),
        )
        .unwrap();
        let series = serde_json::to_value(
            sales_series(&shop.db, &admin(), &march(10, 13), "day")
                .await
                .unwrap(),
        )
        .unwrap();
        let keys = [
            "advanceCollectedMinor",
            "balanceCollectedMinor",
            "advanceRefundedMinor",
            "balanceRefundedMinor",
        ];
        for key in keys {
            assert!(overview["today"][key].is_i64(), "summary lacks {key}");
            assert!(overview["monthToDate"][key].is_i64(), "month lacks {key}");
            assert!(
                series["points"][0][key].is_i64(),
                "series point lacks {key}"
            );
        }
        assert!(overview["receivable"]["orders"].is_i64());
        assert!(overview["receivable"]["minor"].is_i64());
    });
}
