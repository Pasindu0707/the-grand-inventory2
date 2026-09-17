-- Login attempt tracking for PIN lockout.
--
-- A 4-6 digit PIN on a shared tablet is only safe with a lockout, and a
-- lockout held in process memory resets every deploy -- which is exactly when
-- someone would notice they can brute-force it. This lives in the database.

begin;

create table login_attempts (
  user_id         int primary key references users(id) on delete cascade,
  failed_count    int not null default 0,
  locked_until    timestamptz,
  last_attempt_at timestamptz not null default now()
);

create index on login_attempts (locked_until) where locked_until is not null;

commit;
