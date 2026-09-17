-- One decision about bad stock, not three.
--
-- CR-006. The chain used to be: the kitchen hands stock back, management
-- approves the hand-back, the storekeeper writes up a supplier return,
-- management approves that too, the storekeeper sends it, management settles
-- it. Five steps and two management approvals, one of which -- approving the
-- hand-back -- blocked nothing and changed nothing, because the stock had
-- already moved when the section handed it over.
--
-- And the outcome nobody had designed for was the common one: the supplier
-- will not take it back and it has to be binned. That had no route at all. It
-- was done by logging wastage against the quarantine section, which worked,
-- was approved by nobody, and appeared in no process document.
--
-- So the store now asks management one question -- **send it back, or bin it?**
-- -- with the delivery, the packs and the money already worked out, and
-- management answers it line by line. That answer is the only approval in the
-- chain, and every line ends somewhere.
--
-- The tables keep their names. `supplier_returns` is still the document that
-- claims money from a supplier; what has changed is that a line on it can be
-- decided the other way and end in the bin instead.

begin;

-- ── The decision, per line ──────────────────────────────────────────────────
--
-- Null until management has answered. Deliberately text rather than an enum:
-- the two answers are the whole design and a third would be a conversation,
-- not a migration.
alter table supplier_return_lines
    add column decision text
        check (decision in ('vendor', 'waste'));

comment on column supplier_return_lines.decision is
    'What management decided for this line: back to the vendor, or into the bin. Null until they answer.';

-- What binning it actually produced. Set when the storekeeper presses the
-- button, and the reason the write-off is auditable: it points at a real
-- wastage document with a reason code and an author on it.
alter table supplier_return_lines
    add column wastage_id bigint references wastage(id);

comment on column supplier_return_lines.wastage_id is
    'The wastage document this line was binned under. Null unless decision = waste and it has been binned.';

-- A line that has been binned must say so, and a line that has not must not
-- carry a wastage document. The pair only makes sense together.
alter table supplier_return_lines
    add constraint supplier_return_lines_waste_consistent
        check (wastage_id is null or decision = 'waste');

create index if not exists idx_srl_decision on supplier_return_lines (decision);

-- ── A reason for binning it ─────────────────────────────────────────────────
--
-- Binning quarantined stock posts a real wastage document, so it needs a real
-- wastage reason. None of the existing five fits: it was not spoiled in our
-- fridge, not burnt, not dropped and not broken -- it arrived bad and the
-- supplier would not take it back. Saying "Spoiled / expired" instead would
-- put somebody else's fault in our spoilage figures, which is precisely the
-- kind of quiet mislabelling the wastage report exists to avoid.
insert into reason_codes (code, doc, label) values
  ('BADGOODS', 'wastage', 'Bad goods, not taken back')
on conflict (code) do nothing;

-- ── Existing rows ───────────────────────────────────────────────────────────
--
-- Everything raised under the old rules was a vendor claim by definition --
-- there was no other kind -- so every line that already exists is a vendor
-- line. Rows still sitting at `raised` are left undecided, which is exactly
-- what they are: waiting for management to answer the new question.
update supplier_return_lines srl
set decision = 'vendor'
from supplier_returns sr
where sr.id = srl.return_id
  and sr.status in ('approved', 'sent', 'settled');

-- ── The hand-back approval goes away ────────────────────────────────────────
--
-- `section_returns.approved_by` and `approved_at` stay on the table. They are
-- history: sixty days of demo data and any trial data carry them, and dropping
-- a column to tidy up a concept is how you lose the record of who agreed to
-- what last month.
--
-- Nothing writes them from here on. What replaces them is the disposal
-- decision, which is a real decision about real money rather than a stamp on
-- something that had already happened.
comment on column section_returns.approved_by is
    'Historic. The separate hand-back approval was withdrawn by CR-006; the disposal decision on supplier_returns is the approval now.';

commit;
