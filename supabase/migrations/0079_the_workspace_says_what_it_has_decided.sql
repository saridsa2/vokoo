-- Everything an organisation decides, in one place.
--
-- ## A note about building ahead of the readers
--
-- This project's own rule is not to build what nothing reads — eight agent tabs
-- and nine navigation items were deleted for exactly that, and the test was
-- "does anything write what this reads?". These columns are added knowing that,
-- deliberately and at the user's instruction: the structure should exist before
-- the features land, so that adding a reader is one line rather than a
-- migration plus a screen.
--
-- What that costs is a settings page that can lie. So each column below says
-- **which process must read it**, and the console says on screen when nothing
-- does yet. A setting somebody changed that had no effect is worse than one
-- they could not change.
--
-- The compliance columns are the sharp end: somebody switching DND scrubbing on
-- and believing they are compliant is a regulatory problem, not a UI one. They
-- are stored here and the console renders them read-only until outbound exists
-- to honour them.

-- ---- Calls: how the line behaves -------------------------------------------

-- The carrier's own ceiling is three per extension, and a fourth caller gets
-- SIP 486 before the bridge ever sees them. This is a *lower* limit an
-- organisation may set for itself — useful when a clinic would rather a caller
-- got a busy tone than a queue nobody answers.
--
-- READER: none yet. `handle_call` would have to count `LiveCalls` for the org
-- and refuse above it.
alter table organizations add column if not exists max_concurrent_calls integer;

comment on column organizations.max_concurrent_calls is
    'Self-imposed ceiling, below the carrier''s three. Null means the carrier''s limit is the only one. NOT YET ENFORCED.';

-- ---- Data: what is kept ----------------------------------------------------

-- `<start-record/>` is in the answering XML unconditionally today, so every
-- call is recorded and the URL stored on hangup.
--
-- READER: none yet. `kookoo.rs` would have to omit the verb when this is false.
alter table organizations add column if not exists record_calls boolean not null default true;

comment on column organizations.record_calls is
    'Whether the carrier records calls. NOT YET READ — the answering XML always includes <start-record/>.';

-- Strip numbers that look like payment cards or government ids out of a
-- transcript before it is stored.
--
-- READER: none yet. It belongs in `CallRecord` before the transcript is
-- written, not after, because after is a copy that already existed.
alter table organizations add column if not exists redact_transcripts boolean not null default false;

comment on column organizations.redact_transcripts is
    'Remove card and id numbers from transcripts before storing. NOT YET IMPLEMENTED.';

-- ---- Compliance: what we are obliged to do ---------------------------------
--
-- India's TRAI rules for outbound, which this platform will be subject to the
-- day it dials anybody. Recorded now so the shape is agreed before there is a
-- dialer arguing about it.
--
-- READER for all four: none. **Outbound does not exist.** The console renders
-- them read-only for that reason: a compliance setting that stores and does not
-- enforce is the one kind of empty field that can get somebody fined.

alter table organizations add column if not exists dnd_scrubbing boolean not null default true;
comment on column organizations.dnd_scrubbing is
    'Check the national Do Not Disturb registry before dialling. NOT YET ENFORCED — there is no outbound path.';

alter table organizations add column if not exists calling_window_start time;
alter table organizations add column if not exists calling_window_end time;
comment on column organizations.calling_window_start is
    'Earliest hour an outbound call may be placed, in the organisation''s timezone. TRAI forbids 21:00-09:00. NOT YET ENFORCED.';

alter table organizations add column if not exists daily_call_cap integer;
comment on column organizations.daily_call_cap is
    'Most outbound calls in one day. TRAI''s own limit is 50 per registered sender. NOT YET ENFORCED.';

alter table organizations add column if not exists announce_recording boolean not null default false;
comment on column organizations.announce_recording is
    'Tell the caller the call is recorded, before the agent speaks. NOT YET IMPLEMENTED — it belongs in the flow''s first node.';

-- Sensible starting values for the window, which are the regulation's own
-- rather than a guess: TRAI permits 09:00 to 21:00.
update organizations
   set calling_window_start = coalesce(calling_window_start, time '09:00'),
       calling_window_end   = coalesce(calling_window_end,   time '21:00'),
       daily_call_cap       = coalesce(daily_call_cap, 50)
 where calling_window_start is null
    or calling_window_end is null
    or daily_call_cap is null;
