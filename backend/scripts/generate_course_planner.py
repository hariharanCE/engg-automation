#!/usr/bin/env python3
"""
Course Planner Generator
========================

Fills a domain-specific Course Planner template into an .xlsx file.

IMPORTANT COURSE RULE
---------------------

"Query Resolution" is a Friday-only topic for OFFLINE batches.

If Query Resolution occurs in a week's topic sequence:

    - It can only receive that week's Friday date.
    - It must NEVER be moved to Monday-Thursday.
    - If that Friday is a company holiday, the Friday remains a holiday.
    - Query Resolution is NOT moved to Thursday or another weekday.
    - The topic remains without a teaching date rather than violating
      the Friday-only rule.

MID-WEEK START RULE
-------------------

If the batch starts on Monday:

    The planner follows the template exactly as authored.

If the batch starts on Tuesday/Wednesday/Thursday/Friday:

    - The first template week can use ONLY the remaining weekdays of
      that actual calendar week.
    - Dates from the following week must NEVER be inserted into the
      first week's template block.
    - Once Friday is reached, the next teaching date belongs to the
      following Monday.
    - Query Resolution remains attached to the row where it exists in
      the template and receives that calendar week's Friday.
    - If Query Resolution is located later in the template block,
      normal topics cannot consume its reserved Friday.
    - Topics that cannot fit before the reserved Friday are carried
      forward to the next available calendar week.
    - No date from a future calendar week is inserted before the
      current template week's weekend banner.

Example
-------

Batch starts Tuesday:

    Tuesday     09-Sep
    Wednesday   10-Sep
    Thursday    11-Sep
    Friday      12-Sep
    Weekend
    Monday      15-Sep
    Tuesday     16-Sep
    Wednesday   17-Sep
    Thursday    18-Sep
    Friday      19-Sep

The important rule is that the first week never receives 15-Sep,
16-Sep, etc. before its Weekend banner.

ONLINE
------

Existing Saturday/Sunday behavior is preserved.

HOLIDAYS
--------

Company holidays are read from the Holiday list.

Only rows receiving an actual holiday date are converted into
HOLIDAY banners.

Query Resolution on a holiday Friday remains undated.
"""

import datetime
import glob
import json
import os
import re
import sys


# --------------------------------------------------------------------------- #
# Prefer vendored openpyxl/et_xmlfile shipped in ./vendor.
# --------------------------------------------------------------------------- #

sys.path.insert(
    0,
    os.path.join(
        os.path.dirname(
            os.path.abspath(__file__)
        ),
        "vendor"
    )
)

try:
    import openpyxl
    from openpyxl.styles import PatternFill, Font, Alignment
    from openpyxl.cell.cell import MergedCell

except ImportError:
    sys.exit(
        "openpyxl is required. Install it with: pip install openpyxl"
    )


# --------------------------------------------------------------------------- #
# Constants
# --------------------------------------------------------------------------- #

HOLIDAY_FILL = PatternFill(
    start_color="FFF2CC",
    end_color="FFF2CC",
    fill_type="solid"
)

HOLIDAY_FONT = Font(
    bold=True,
    color="FFC00000"
)

TOPIC_COLS = range(3, 10)       # C..I
DATE_COL = 2                    # B

WEEKEND_RE = re.compile(
    r"weekend|saturday\s*&\s*sunday",
    re.I
)

MONDAY = 0
FRIDAY = 4
SATURDAY = 5
SUNDAY = 6

TEACHING_DAYS_PER_WEEK = 5

QUERY_RESOLUTION_RE = re.compile(
    r"\bquery\s*resolution\b",
    re.I
)


# --------------------------------------------------------------------------- #
# Template discovery
# --------------------------------------------------------------------------- #

def find_template(template_dir, domain, batch_type=""):
    """Pick the template workbook for the chosen domain + batch type."""

    dom = domain.strip().lower()
    bt = (batch_type or "").strip().lower()

    candidates = sorted(
        glob.glob(
            os.path.join(
                template_dir,
                "*.xlsx"
            )
        )
    )

    def domain_ok(name):
        return re.search(
            rf"\b{re.escape(dom)}\b",
            name
        ) is not None

    # 1) Preferred template
    if bt:
        for path in candidates:
            name = os.path.basename(path).lower()

            if (
                name.startswith(bt)
                and "course planner template" in name
                and domain_ok(name)
            ):
                return path

    # 2) Backward compatible search
    for path in candidates:
        name = os.path.basename(path).lower()

        if (
            "course planner template" in name
            and domain_ok(name)
            and (
                not bt
                or name.startswith(bt)
            )
        ):
            return path

    # 3) Loosest fallback
    for path in candidates:
        name = os.path.basename(path).lower()

        if (
            "template" in name
            and dom in name
            and (
                not bt
                or name.startswith(bt)
            )
        ):
            return path

    available = sorted(
        os.path.basename(p)
        for p in candidates
        if "course planner template"
        in os.path.basename(p).lower()
    )

    raise FileNotFoundError(
        f"No {batch_type or ''} {domain} course planner template is available. "
        f'Add a workbook named "{batch_type or "<Offline|Online>"} - '
        f'{domain} Course Planner Template.xlsx". '
        f"Templates found: {', '.join(available) or 'none'}"
    )


# --------------------------------------------------------------------------- #
# Header helpers
# --------------------------------------------------------------------------- #

def _header_text(v):
    """Normalise a header cell."""

    return (
        v.replace("\xa0", " ").strip().lower()
        if isinstance(v, str)
        else ""
    )


def find_header_column(ws, data_start, names, default=0):
    """Locate a column by its header label."""

    limit = min(
        ws.max_row,
        max(
            data_start + 2,
            15
        )
    )

    for r in range(1, limit + 1):
        for c in range(1, ws.max_column + 1):

            if (
                _header_text(
                    ws.cell(r, c).value
                )
                in names
            ):
                return c

    return default


def find_date_column(ws, data_start):
    """Locate Date column."""

    return find_header_column(
        ws,
        data_start,
        {"date"},
        DATE_COL
    )


def find_theory_lab_column(ws, data_start):
    """Locate Theory/Lab column."""

    return find_header_column(
        ws,
        data_start,
        {
            "theory/lab",
            "theory / lab"
        },
        0
    )


def session_weekday(ws, value, r, tl_col):
    """Return weekend day for Online Theory/Lab rows."""

    if not tl_col:
        return None

    t = _header_text(
        value(r, tl_col)
    )

    if t.startswith("theory"):
        return SATURDAY

    if t.startswith("lab"):
        return SUNDAY

    return None


# --------------------------------------------------------------------------- #
# Date helpers
# --------------------------------------------------------------------------- #

def on_or_after(d, weekday):
    """First date on or after d matching weekday."""

    return d + datetime.timedelta(
        days=(
            weekday - d.weekday()
        ) % 7
    )


def weekend_of(d):
    """Return Saturday/Sunday for the weekend containing d."""

    wd = d.weekday()

    if wd == SATURDAY:
        return (
            d,
            d + datetime.timedelta(days=1)
        )

    if wd == SUNDAY:
        return (
            d - datetime.timedelta(days=1),
            d
        )

    sat = d + datetime.timedelta(
        days=(SATURDAY - wd)
    )

    return (
        sat,
        sat + datetime.timedelta(days=1)
    )


def next_weekend_after(d):
    """Return the weekend following d's weekend."""

    sat, sun = weekend_of(d)

    return (
        sat + datetime.timedelta(days=7),
        sun + datetime.timedelta(days=7)
    )


def next_working_day(d, holidays=None):
    """
    Return the next Monday-Friday date.

    Holidays are NOT skipped here because a holiday must be stamped
    onto the corresponding planner row and converted into a holiday
    banner.
    """

    while d.weekday() >= SATURDAY:
        d += datetime.timedelta(days=1)

    return d


def next_monday(d):
    """Return Monday on or after the supplied date."""

    return on_or_after(
        d,
        MONDAY
    )


def next_friday(d):
    """Return Friday on or after d."""

    return on_or_after(
        d,
        FRIDAY
    )


# --------------------------------------------------------------------------- #
# Course break
# --------------------------------------------------------------------------- #

def fill_course_break(
    ws,
    r,
    last_stamped,
    current
):
    """Handle Online Course Break placeholder."""

    for c in range(
        1,
        ws.max_column + 1
    ):

        tc = target_cell(
            ws,
            r,
            c
        )

        v = tc.value

        if (
            isinstance(v, str)
            and "(current_weekend)" in v
        ):

            if last_stamped is not None:
                sat, sun = next_weekend_after(
                    last_stamped
                )
            else:
                sat, sun = weekend_of(
                    current
                )

            label = (
                f"{sat.strftime('%d-%b-%Y')} & "
                f"{sun.strftime('%d-%b-%Y')}"
            )

            tc.value = v.replace(
                "(current_weekend)",
                label
            )

            return (
                True,
                sun + datetime.timedelta(days=1)
            )

    return (
        False,
        None
    )


# --------------------------------------------------------------------------- #
# Holiday list
# --------------------------------------------------------------------------- #

def load_holidays(holiday_file):
    """
    Return:

        {
            date: holiday_name
        }

    Only Type of Holiday == Holiday is treated as a full holiday.
    """

    holidays = {}

    if (
        not holiday_file
        or not os.path.exists(holiday_file)
    ):
        return holidays

    wb = openpyxl.load_workbook(
        holiday_file,
        data_only=True
    )

    ws = wb.active

    header = {
        str(
            ws.cell(1, c).value
        ).strip().lower(): c

        for c in range(
            1,
            ws.max_column + 1
        )

        if ws.cell(1, c).value
    }

    date_c = header.get(
        "date",
        1
    )

    name_c = header.get(
        "holiday",
        3
    )

    type_c = header.get(
        "type of holiday",
        4
    )

    for r in range(
        2,
        ws.max_row + 1
    ):

        d = ws.cell(
            r,
            date_c
        ).value

        t = ws.cell(
            r,
            type_c
        ).value

        if isinstance(
            d,
            datetime.datetime
        ):
            d = d.date()

        if not isinstance(
            d,
            datetime.date
        ):
            continue

        if (
            str(t).strip().lower()
            == "holiday"
        ):

            holidays[d] = str(
                ws.cell(
                    r,
                    name_c
                ).value
                or "Holiday"
            ).strip()

    return holidays


# --------------------------------------------------------------------------- #
# Merge-aware helpers
# --------------------------------------------------------------------------- #

def build_resolvers(ws):
    """Build merge-aware value/span resolvers."""

    anchor = {}
    width = {}

    for m in ws.merged_cells.ranges:

        a = ws.cell(
            m.min_row,
            m.min_col
        ).value

        for r in range(
            m.min_row,
            m.max_row + 1
        ):

            for c in range(
                m.min_col,
                m.max_col + 1
            ):

                anchor[
                    (r, c)
                ] = a

                width[
                    (r, c)
                ] = (
                    m.max_col
                    - m.min_col
                )

    value = lambda r, c: anchor.get(
        (r, c),
        ws.cell(r, c).value
    )

    span = lambda r, c: width.get(
        (r, c),
        0
    )

    return (
        value,
        span
    )


def target_cell(ws, r, c):
    """Return writable cell for a possibly merged location."""

    for m in ws.merged_cells.ranges:

        if (
            m.min_row <= r <= m.max_row
            and m.min_col <= c <= m.max_col
        ):

            return ws.cell(
                m.min_row,
                m.min_col
            )

    return ws.cell(
        r,
        c
    )


def set_cell(ws, r, c, val):
    """Write to a cell respecting merges."""

    target_cell(
        ws,
        r,
        c
    ).value = val


# --------------------------------------------------------------------------- #
# Metadata
# --------------------------------------------------------------------------- #

def fill_metadata(ws, cfg):
    """Fill batch metadata."""

    s1 = cfg.get(
        "session1",
        ""
    )

    s2 = cfg.get(
        "session2",
        ""
    )

    s3 = cfg.get(
        "session3",
        ""
    )

    batch = cfg["batch_no"]
    dom = cfg["domain"]

    lab = cfg.get(
        "lab_timings",
        ""
    )

    for row in ws.iter_rows():

        for cell in row:

            v = cell.value

            if not isinstance(
                v,
                str
            ):
                continue

            new = v

            new = new.replace(
                "(batch_no)",
                batch
            )

            new = new.replace(
                "(session1_timings)",
                s1
            )

            new = new.replace(
                "(session2_timinigs)",
                s2
            )

            new = new.replace(
                "(session2_timings)",
                s2
            )

            new = new.replace(
                "(session3_timings)",
                s3
            )

            new = re.sub(
                r"(Session\s*1\s*:)[ \t]*",
                rf"\g<1> {s1}",
                new
            )

            new = re.sub(
                r"(Session\s*2\s*:)[ \t]*",
                rf"\g<1> {s2}",
                new
            )

            if s3:

                new = re.sub(
                    r"(Session\s*3\s*:)[ \t]*",
                    rf"\g<1> {s3}",
                    new
                )

            low = v.lower()

            if (
                low.strip().rstrip(":")
                == "domain"
                or low.startswith("domain:")
            ):

                new = f"Domain: {dom}"

            elif (
                low.strip().rstrip(":")
                == "batch no"
                or low.startswith("batch no:")
            ):

                new = f"Batch No: {batch}"

            elif (
                low.startswith(
                    "lab access timings"
                )
                and lab
                and lab not in v
            ):

                new = (
                    f"{v.rstrip()}\n{lab}"
                )

            if (
                s1
                and re.match(
                    r"module name\s*-\s*s1",
                    low
                )
            ):

                new = re.sub(
                    r"(Module Name\s*-\s*S1\s*\n).*",
                    rf"\g<1>{s1}",
                    new,
                    flags=re.I | re.S
                )

            if (
                s2
                and re.match(
                    r"module name\s*-\s*s2",
                    low
                )
            ):

                new = re.sub(
                    r"(Module Name\s*-\s*S2\s*\n).*",
                    rf"\g<1>{s2}",
                    new,
                    flags=re.I | re.S
                )

            if (
                s3
                and re.match(
                    r"module name\s*-\s*s3",
                    low
                )
            ):

                new = re.sub(
                    r"(Module Name\s*-\s*S3\s*\n).*",
                    rf"\g<1>{s3}",
                    new,
                    flags=re.I | re.S
                )

            if new != v:
                cell.value = new


# --------------------------------------------------------------------------- #
# Row detection
# --------------------------------------------------------------------------- #

def first_data_row(ws):
    """Find first Week-No row."""

    return next(
        (
            r
            for r in range(
                1,
                ws.max_row + 1
            )

            if isinstance(
                ws.cell(r, 1).value,
                (int, float)
            )

            and not isinstance(
                ws.cell(r, 1),
                bool
            )
        ),
        5
    )


def last_content_row(ws):
    """Find last row containing content."""

    for r in range(
        ws.max_row,
        0,
        -1
    ):

        if any(
            ws.cell(r, c).value is not None
            for c in range(
                1,
                ws.max_column + 1
            )
        ):

            return r

    return ws.max_row


def is_weekend_row(
    value,
    r,
    date_col
):
    """Detect weekend banner row."""

    v = value(
        r,
        date_col
    )

    return (
        isinstance(v, str)
        and bool(
            WEEKEND_RE.search(v)
        )
    )


# --------------------------------------------------------------------------- #
# Query Resolution detection
# --------------------------------------------------------------------------- #

def row_contains_query_resolution(
    ws,
    r,
    topic_cols
):
    """
    Detect whether a schedule row contains Query Resolution.
    """

    for c in topic_cols:

        raw = ws.cell(
            r,
            c
        ).value

        if raw is None:
            continue

        text = str(
            raw
        ).replace(
            "\xa0",
            " "
        )

        if QUERY_RESOLUTION_RE.search(text):
            return True

    return False


def is_query_resolution_row(
    ws,
    r,
    date_col,
    topic_cols
):
    """
    Return True if this row represents Query Resolution.

    RAW topic cells are intentionally used here.
    """

    return row_contains_query_resolution(
        ws,
        r,
        topic_cols
    )


# --------------------------------------------------------------------------- #
# Row classification
# --------------------------------------------------------------------------- #

def is_day_row(
    ws,
    value,
    span,
    r,
    date_col,
    topic_cols
):
    """Determine whether row represents a teaching day."""

    b = value(
        r,
        date_col
    )

    if (
        isinstance(b, str)
        and WEEKEND_RE.search(b)
    ):
        return False

    if (
        isinstance(b, str)
        and span(r, date_col) >= 5
    ):
        return False

    for c in topic_cols:

        v = ws.cell(
            r,
            c
        ).value

        if (
            v is not None
            and str(v).strip()
        ):
            return True

    return False


def classify_rows(
    ws,
    value,
    span,
    data_start,
    region_end,
    date_col,
    topic_cols
):
    """Classify schedule rows."""

    kind = {}

    for r in range(
        data_start,
        region_end + 1
    ):

        if is_weekend_row(
            value,
            r,
            date_col
        ):

            kind[r] = "weekend"

        elif is_day_row(
            ws,
            value,
            span,
            r,
            date_col,
            topic_cols
        ):

            kind[r] = "day"

        else:

            kind[r] = "other"

    return kind


# --------------------------------------------------------------------------- #
# Week numbering
# --------------------------------------------------------------------------- #

def merges_touching(
    ws,
    row_start,
    row_end
):
    """Find merged ranges touching region."""

    return [
        m

        for m in list(
            ws.merged_cells.ranges
        )

        if (
            m.max_row >= row_start
            and m.min_row <= row_end
        )
    ]


def renumber_weeks(
    ws,
    data_start,
    region_end,
    kind_by_row
):
    """
    Renumber Week No according to the template's weekend banner blocks.

    No rows are moved.
    """

    for m in [
        m
        for m in merges_touching(
            ws,
            data_start,
            region_end
        )

        if (
            m.min_col == 1
            and m.max_col == 1
        )
    ]:

        ws.unmerge_cells(
            str(m)
        )

    banner_rows = set()

    for m in ws.merged_cells.ranges:

        if (
            m.min_col == 1
            and m.max_col > 1
        ):

            banner_rows.update(
                range(
                    m.min_row,
                    m.max_row + 1
                )
            )

    blocks = []
    cur = []

    for r in range(
        data_start,
        region_end + 1
    ):

        if kind_by_row.get(r) == "weekend":

            blocks.append(
                (
                    cur,
                    r
                )
            )

            cur = []

        else:

            cur.append(r)

    if cur:

        blocks.append(
            (
                cur,
                None
            )
        )

    week = 0

    for rows, weekend_row in blocks:

        if not any(
            kind_by_row.get(r) == "day"
            for r in rows
        ):
            continue

        week += 1

        for r in rows:

            if (
                r not in banner_rows
                and not isinstance(
                    ws.cell(r, 1),
                    MergedCell
                )
            ):

                ws.cell(
                    r,
                    1
                ).value = None

        first = rows[0]
        last = rows[-1]

        if (
            weekend_row is not None
            and weekend_row not in banner_rows
        ):

            last = weekend_row

        ws.cell(
            first,
            1
        ).value = week

        if last > first:

            ws.merge_cells(
                start_row=first,
                start_column=1,
                end_row=last,
                end_column=1
            )

    return week


def reflow_for_start(
    ws,
    data_start,
    date_col
):
    """
    Compute Week No labels without moving template rows.
    """

    region_end = last_content_row(
        ws
    )

    value, span = build_resolvers(
        ws
    )

    topic_cols = range(
        date_col + 1,
        date_col + 8
    )

    kind = classify_rows(
        ws,
        value,
        span,
        data_start,
        region_end,
        date_col,
        topic_cols
    )

    weeks = renumber_weeks(
        ws,
        data_start,
        region_end,
        kind
    )

    first_week_days = 0

    for r in range(
        data_start,
        region_end + 1
    ):

        if kind.get(r) == "weekend":
            break

        if kind.get(r) == "day":
            first_week_days += 1

    return (
        weeks,
        first_week_days
    )


# --------------------------------------------------------------------------- #
# Holiday banner
# --------------------------------------------------------------------------- #

def _split_merge_around_row(
    ws,
    m,
    r
):
    """Split merge around holiday row."""

    r0 = m.min_row
    c0 = m.min_col
    r1 = m.max_row
    c1 = m.max_col

    ws.unmerge_cells(
        str(m)
    )

    for a, b in (
        (
            r0,
            r - 1
        ),
        (
            r + 1,
            r1
        )
    ):

        if (
            b < a
            or (
                a == b
                and c0 == c1
            )
        ):
            continue

        ws.merge_cells(
            start_row=a,
            start_column=c0,
            end_row=b,
            end_column=c1
        )


def mark_holiday_row(
    ws,
    r,
    name,
    banner_start,
    banner_end,
    note_col,
    last_col
):
    """Turn a teaching row into a full-width holiday banner."""

    for m in list(
        ws.merged_cells.ranges
    ):

        if (
            m.max_col < banner_start
            or m.min_col > banner_end
        ):
            continue

        if (
            m.max_row < r
            or m.min_row > r
        ):
            continue

        _split_merge_around_row(
            ws,
            m,
            r
        )

    for c in range(
        banner_start,
        banner_end + 1
    ):

        ws.cell(
            r,
            c
        ).value = None

    if banner_end > banner_start:

        ws.merge_cells(
            start_row=r,
            start_column=banner_start,
            end_row=r,
            end_column=banner_end
        )

    banner = ws.cell(
        r,
        banner_start
    )

    banner.value = (
        f"HOLIDAY - {name}"
    )

    banner.font = HOLIDAY_FONT

    banner.alignment = Alignment(
        horizontal="center",
        vertical="center",
        wrap_text=True
    )

    ws.cell(
        r,
        note_col
    ).value = (
        f"Holiday - {name}"
    )

    for c in range(
        1,
        last_col + 1
    ):

        ws.cell(
            r,
            c
        ).fill = HOLIDAY_FILL


# --------------------------------------------------------------------------- #
# OFFLINE WEEK BLOCK HELPERS
# --------------------------------------------------------------------------- #

def get_week_blocks(
    ws,
    data_start,
    region_end,
    value,
    date_col
):
    """
    Return template week blocks.

    Each block is:

        {
            "rows": [...],
            "weekend_row": row_number_or_None
        }

    The template's weekend banner is the hard boundary between
    calendar-week planning blocks.
    """

    blocks = []

    current_rows = []

    for r in range(
        data_start,
        region_end + 1
    ):

        if is_weekend_row(
            value,
            r,
            date_col
        ):

            if current_rows:

                blocks.append(
                    {
                        "rows": current_rows,
                        "weekend_row": r
                    }
                )

            current_rows = []

        else:

            current_rows.append(r)

    if current_rows:

        blocks.append(
            {
                "rows": current_rows,
                "weekend_row": None
            }
        )

    return blocks


def block_has_query_resolution(
    ws,
    rows,
    date_col,
    topic_cols
):
    """
    Check whether the given template week block contains
    Query Resolution.
    """

    for r in rows:

        if is_query_resolution_row(
            ws,
            r,
            date_col,
            topic_cols
        ):
            return True

    return False


def query_resolution_row_in_block(
    ws,
    rows,
    date_col,
    topic_cols
):
    """Return the Query Resolution row in a block, if present."""

    for r in rows:

        if is_query_resolution_row(
            ws,
            r,
            date_col,
            topic_cols
        ):

            return r

    return None


def available_weekdays_from(
    start_date
):
    """
    Return all Monday-Friday dates remaining in the calendar week,
    starting from start_date.

    Example:

        Tuesday -> Tue, Wed, Thu, Fri
        Wednesday -> Wed, Thu, Fri
        Thursday -> Thu, Fri
        Friday -> Fri
    """

    start_date = next_working_day(
        start_date
    )

    days = []

    current = start_date

    while current.weekday() <= FRIDAY:

        days.append(
            current
        )

        current += datetime.timedelta(
            days=1
        )

    return days


def next_week_start_after(
    d
):
    """
    Return Monday of the calendar week following d's week.
    """

    monday = d - datetime.timedelta(
        days=d.weekday()
    )

    return monday + datetime.timedelta(
        days=7
    )


# --------------------------------------------------------------------------- #
# Date + holiday fill
# --------------------------------------------------------------------------- #

def fill_dates(
    ws,
    start_date,
    holidays,
    date_col,
    online=False
):
    """
    Stamp dates down the day rows and mark holidays.

    OFFLINE
    -------

    The template's weekend banners define week blocks.

    A template week block is NEVER allowed to consume dates from the
    next calendar week.

    For a Monday start:

        Mon -> Tue -> Wed -> Thu -> Fri

    For a Tuesday start:

        Tue -> Wed -> Thu -> Fri

    Then the next template week starts on Monday.

    Query Resolution:

        - Always Friday.
        - Uses the Friday belonging to that calendar week.
        - Never moves to Thursday.
        - Never moves to the following Friday merely because its row
          appears later in the template.
        - If Friday is a holiday, Query Resolution remains undated.

    IMPORTANT
    ---------

    The date pointer is advanced based on calendar weeks, not merely
    by row count.

    Therefore a mid-week start cannot cause:

        Week 1:
            Tue
            Wed
            Thu
            Mon(next week)
            Fri

    which was the original bug.

    Instead, Week 1 is strictly bounded by its actual Friday.
    """

    value, span = build_resolvers(
        ws
    )

    topic_cols = range(
        date_col + 1,
        date_col + 8
    )

    current = start_date

    marked = 0
    last_stamped = None

    data_start = first_data_row(
        ws
    )

    region_end = last_content_row(
        ws
    )

    header_row = data_start - 1

    tl_col = (
        find_theory_lab_column(
            ws,
            data_start
        )
        if online
        else 0
    )

    note_col = ws.max_column + 1
    last_col = note_col

    banner_start = date_col + 1

    banner_end = weekend_banner_end(
        ws,
        data_start,
        region_end,
        value,
        date_col
    )

    if banner_end < banner_start:
        banner_end = note_col - 1

    ws.cell(
        header_row,
        note_col
    ).value = "Remarks"

    # ------------------------------------------------------------------ #
    # ONLINE
    # ------------------------------------------------------------------ #

    if online:

        for r in range(
            data_start,
            ws.max_row + 1
        ):

            handled, resume_from = fill_course_break(
                ws,
                r,
                last_stamped,
                current
            )

            if handled:

                if resume_from is not None:

                    current = resume_from
                    last_stamped = None

                continue

            if not is_day_row(
                ws,
                value,
                span,
                r,
                date_col,
                topic_cols
            ):
                continue

            want = session_weekday(
                ws,
                value,
                r,
                tl_col
            )

            if want is not None:

                current = on_or_after(
                    current,
                    want
                )

            else:

                while current.weekday() < SATURDAY:

                    current += datetime.timedelta(
                        days=1
                    )

            set_cell(
                ws,
                r,
                date_col,
                current
            )

            ws.cell(
                r,
                date_col
            ).number_format = "m/d/yyyy"

            last_stamped = current

            current += datetime.timedelta(
                days=1
            )

        return marked

    # ------------------------------------------------------------------ #
    # OFFLINE
    # ------------------------------------------------------------------ #

    blocks = get_week_blocks(
        ws,
        data_start,
        region_end,
        value,
        date_col
    )

    # ------------------------------------------------------------------ #
    # Process each TEMPLATE week block separately.
    #
    # This is the important fix.
    #
    # current is allowed to move to the following calendar week ONLY
    # after the current template block has completely finished.
    # ------------------------------------------------------------------ #

    first_block = True

    for block_index, block in enumerate(
        blocks
    ):

        rows = block["rows"]

        if not rows:
            continue

        # -------------------------------------------------------------- #
        # Establish the beginning of this calendar week.
        # -------------------------------------------------------------- #

        if first_block:

            block_start = current

            # Offline batches cannot start Saturday/Sunday.
            block_start = next_working_day(
                block_start
            )

            first_block = False

        else:

            # Every template block after the first one begins on the
            # following Monday.
            block_start = next_monday(
                current
            )

        # -------------------------------------------------------------- #
        # IMPORTANT:
        #
        # The calendar Friday for THIS block is determined NOW.
        #
        # If this is a Tuesday start:
        #
        #     block_start = Tuesday
        #     block_friday = same week's Friday
        #
        # It can NEVER become next week's Friday.
        # -------------------------------------------------------------- #

        block_friday = next_friday(
            block_start
        )

        # -------------------------------------------------------------- #
        # Determine where Query Resolution lives in this template block.
        # -------------------------------------------------------------- #

        qr_row = query_resolution_row_in_block(
            ws,
            rows,
            date_col,
            topic_cols
        )

        # -------------------------------------------------------------- #
        # Build the actual dates available to this block.
        #
        # For first block:
        #
        #     Tue -> Wed -> Thu -> Fri
        #
        # For subsequent blocks:
        #
        #     Mon -> Tue -> Wed -> Thu -> Fri
        # -------------------------------------------------------------- #

        block_dates = []

        d = block_start

        while d <= block_friday:

            if d.weekday() <= FRIDAY:

                block_dates.append(
                    d
                )

            d += datetime.timedelta(
                days=1
            )

        # -------------------------------------------------------------- #
        # If QR exists, Friday belongs to QR.
        #
        # Normal topics must never consume it.
        # -------------------------------------------------------------- #

        normal_dates = [
            d
            for d in block_dates
            if d != block_friday
        ]

        normal_date_index = 0

        qr_processed = False

        # -------------------------------------------------------------- #
        # Track topics that belong to this template block but cannot
        # fit into the remaining calendar days.
        #
        # They are NOT allowed to receive next week's dates here.
        #
        # The actual topic remains in the same template row.
        # Its date is left blank rather than contaminating this week's
        # calendar with next week's date.
        #
        # Subsequent blocks will continue the calendar plan.
        # -------------------------------------------------------------- #

        for r in rows:

            # ---------------------------------------------------------- #
            # Skip non-teaching rows.
            # ---------------------------------------------------------- #

            if not is_day_row(
                ws,
                value,
                span,
                r,
                date_col,
                topic_cols
            ):
                continue

            query_resolution = (
                r == qr_row
            )

            # ---------------------------------------------------------- #
            # QUERY RESOLUTION
            # ---------------------------------------------------------- #

            if query_resolution:

                friday = block_friday

                # ------------------------------------------------------ #
                # If Friday is a company holiday:
                #
                # - Keep Friday as the holiday.
                # - QR remains undated.
                # - Do NOT move QR to Thursday.
                # ------------------------------------------------------ #

                if friday in holidays:

                    clear_query_resolution_date(
                        ws,
                        r,
                        date_col
                    )

                    mark_holiday_row(
                        ws,
                        r,
                        holidays[friday],
                        banner_start,
                        banner_end,
                        note_col,
                        last_col
                    )

                    marked += 1
                    qr_processed = True

                    continue

                # ------------------------------------------------------ #
                # Friday is available.
                # ------------------------------------------------------ #

                set_cell(
                    ws,
                    r,
                    date_col,
                    friday
                )

                ws.cell(
                    r,
                    date_col
                ).number_format = "m/d/yyyy"

                last_stamped = friday

                qr_processed = True

                continue

            # ---------------------------------------------------------- #
            # NORMAL TOPIC
            # ---------------------------------------------------------- #

            # If there is a Query Resolution row in this block,
            # Friday is reserved for it.
            #
            # Therefore normal topics can use ONLY:
            #
            #     block_start ... Thursday
            #
            # never Friday.
            # ---------------------------------------------------------- #

            if qr_row is not None:

                if (
                    normal_date_index
                    >= len(normal_dates)
                ):
                    # No calendar date remaining in this week.
                    #
                    # IMPORTANT:
                    #
                    # Do NOT use Monday of the next week here.
                    # That was the original bug.
                    #
                    # Leave the date blank. The next template block
                    # starts on the next calendar week.
                    clear_date = target_cell(
                        ws,
                        r,
                        date_col
                    )

                    clear_date.value = None

                    continue

                assigned_date = normal_dates[
                    normal_date_index
                ]

                normal_date_index += 1

            else:

                # ------------------------------------------------------ #
                # No QR in this block.
                #
                # All available weekdays can be used.
                # ------------------------------------------------------ #

                if (
                    normal_date_index
                    >= len(block_dates)
                ):

                    clear_date = target_cell(
                        ws,
                        r,
                        date_col
                    )

                    clear_date.value = None

                    continue

                assigned_date = block_dates[
                    normal_date_index
                ]

                normal_date_index += 1

            # ---------------------------------------------------------- #
            # Safety check:
            #
            # A row in this block MUST NEVER receive a date after
            # this block's Friday.
            # ---------------------------------------------------------- #

            if assigned_date > block_friday:

                clear_date = target_cell(
                    ws,
                    r,
                    date_col
                )

                clear_date.value = None

                continue

            # ---------------------------------------------------------- #
            # Stamp date.
            # ---------------------------------------------------------- #

            set_cell(
                ws,
                r,
                date_col,
                assigned_date
            )

            ws.cell(
                r,
                date_col
            ).number_format = "m/d/yyyy"

            last_stamped = assigned_date

            # ---------------------------------------------------------- #
            # Company holiday.
            #
            # The date belongs to this calendar week, so it is converted
            # to a holiday banner here.
            # ---------------------------------------------------------- #

            if assigned_date in holidays:

                mark_holiday_row(
                    ws,
                    r,
                    holidays[assigned_date],
                    banner_start,
                    banner_end,
                    note_col,
                    last_col
                )

                marked += 1

        # ---------------------------------------------------------------- #
        # IMPORTANT:
        #
        # We NEVER advance current based on the last row's date.
        #
        # The entire block has a fixed calendar boundary.
        #
        # The next block ALWAYS begins on the following Monday.
        # ---------------------------------------------------------------- #

        current = block_friday + datetime.timedelta(
            days=1
        )

        current = next_working_day(
            current
        )

    return marked


# --------------------------------------------------------------------------- #
# Weekend banner helper
# --------------------------------------------------------------------------- #

def weekend_banner_end(
    ws,
    data_start,
    region_end,
    value,
    date_col
):
    """
    Determine the last column used by the weekend banner.
    """

    end = 0

    for r in range(
        data_start,
        region_end + 1
    ):

        if not is_weekend_row(
            value,
            r,
            date_col
        ):
            continue

        for m in ws.merged_cells.ranges:

            if (
                m.min_row == r
                and m.min_col <= date_col <= m.max_col
            ):

                end = max(
                    end,
                    m.max_col
                )

    return end


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #

def main():

    cfg = json.load(
        sys.stdin
    )

    batch_type = cfg.get(
        "batch_type",
        ""
    )

    online = (
        batch_type.strip().lower()
        == "online"
    )

    # ------------------------------------------------------------------ #
    # Template
    # ------------------------------------------------------------------ #

    try:

        template = find_template(
            cfg["template_dir"],
            cfg["domain"],
            batch_type
        )

    except FileNotFoundError as e:

        sys.exit(
            str(e)
        )

    # ------------------------------------------------------------------ #
    # Holidays
    # ------------------------------------------------------------------ #

    holidays = load_holidays(
        cfg.get(
            "holiday_file"
        )
    )

    # ------------------------------------------------------------------ #
    # Start date
    # ------------------------------------------------------------------ #

    start = cfg.get(
        "start_date"
    )

    if start:

        start_date = datetime.datetime.strptime(
            start,
            "%Y-%m-%d"
        ).date()

    else:

        start_date = None

    # ------------------------------------------------------------------ #
    # Workbook
    # ------------------------------------------------------------------ #

    wb = openpyxl.load_workbook(
        template
    )

    ws = wb.active

    # ------------------------------------------------------------------ #
    # Metadata
    # ------------------------------------------------------------------ #

    fill_metadata(
        ws,
        cfg
    )

    holidays_marked = 0
    weeks = 0
    first_week_days = 0

    # ------------------------------------------------------------------ #
    # Date processing
    # ------------------------------------------------------------------ #

    if start_date:

        data_start = first_data_row(
            ws
        )

        date_col = find_date_column(
            ws,
            data_start
        )

        # -------------------------------------------------------------- #
        # Offline batches cannot start Saturday/Sunday.
        # -------------------------------------------------------------- #

        if not online:

            if start_date.weekday() >= SATURDAY:

                start_date = on_or_after(
                    start_date,
                    MONDAY
                )

            # ---------------------------------------------------------- #
            # Recompute Week No labels.
            #
            # Rows are NEVER moved.
            # ---------------------------------------------------------- #

            weeks, first_week_days = reflow_for_start(
                ws,
                data_start,
                date_col
            )

        # -------------------------------------------------------------- #
        # Fill dates.
        # -------------------------------------------------------------- #

        holidays_marked = fill_dates(
            ws,
            start_date,
            holidays,
            date_col,
            online
        )

    # ------------------------------------------------------------------ #
    # Save
    # ------------------------------------------------------------------ #

    out_path = cfg["out_path"]

    wb.save(
        out_path
    )

    # ------------------------------------------------------------------ #
    # Result
    # ------------------------------------------------------------------ #

    print(
        json.dumps(
            {
                "ok": True,

                "template": os.path.basename(
                    template
                ),

                "out_path": out_path,

                "holidays_marked":
                    holidays_marked,

                "start_date":
                    start,

                "effective_start_date":
                    (
                        start_date.isoformat()
                        if start_date
                        else None
                    ),

                "start_weekday":
                    (
                        start_date.strftime("%A")
                        if start_date
                        else None
                    ),

                "weeks":
                    weeks,

                "first_week_days":
                    first_week_days,

                "batch_type":
                    batch_type,

                "online":
                    online
            }
        )
    )


if __name__ == "__main__":
    main()