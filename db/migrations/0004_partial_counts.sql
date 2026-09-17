-- Partial stock counts.
--
-- Until now a count line was created with qty_counted = 0 and the column was
-- NOT NULL, which made "nobody has counted this yet" indistinguishable from
-- "somebody counted it and the shelf was empty". closeCount read the column
-- straight out and posted an adjustment for every line, so closing a count
-- that had not been fully entered would write off the stock of everything
-- untouched. The only thing standing between that and the ledger was the UI
-- refusing to let anyone skip a line - which is exactly the thing that made
-- counting a hundred items every morning unbearable.
--
-- Making the column nullable turns "not counted" into a state the database can
-- hold, so a count can cover part of a section and leave the rest alone.
--
-- Existing rows are left as they are: a closed count's zeros were entered under
-- the old rules and re-interpreting them now would rewrite history.

begin;

alter table stock_count_lines
    alter column qty_counted drop not null,
    alter column qty_counted drop default;

-- Only rows belonging to counts still open can safely be reset: nothing has
-- been posted from them yet, and under the old flow a 0 there means "not
-- reached", never "counted zero" - the UI would not let you past a line
-- without typing something.
update stock_count_lines l
   set qty_counted = null
  from stock_counts c
 where c.id = l.count_id
   and c.closed_at is null
   and l.qty_counted = 0;

comment on column stock_count_lines.qty_counted is
    'What was on the shelf. NULL means this line was not counted; close skips it.';

commit;
