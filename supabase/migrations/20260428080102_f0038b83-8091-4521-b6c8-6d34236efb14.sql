-- Matchmaking queue
create table public.matchmaking_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  created_at timestamptz not null default now()
);

alter table public.matchmaking_queue enable row level security;

create policy "Users see own queue entry"
  on public.matchmaking_queue for select
  to authenticated using (auth.uid() = user_id);

create policy "Users insert own queue entry"
  on public.matchmaking_queue for insert
  to authenticated with check (auth.uid() = user_id);

create policy "Users delete own queue entry"
  on public.matchmaking_queue for delete
  to authenticated using (auth.uid() = user_id);

-- Matches
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  white_id uuid not null,
  black_id uuid not null,
  white_name text,
  black_name text,
  fen text not null default 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  moves jsonb not null default '[]'::jsonb,
  status text not null default 'active', -- active | finished
  result text, -- white | black | draw
  winner_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

alter table public.matches enable row level security;

create policy "Players see own matches"
  on public.matches for select
  to authenticated
  using (auth.uid() = white_id or auth.uid() = black_id);

create policy "Players update own matches"
  on public.matches for update
  to authenticated
  using (auth.uid() = white_id or auth.uid() = black_id);

create index idx_matches_white on public.matches(white_id);
create index idx_matches_black on public.matches(black_id);

create trigger update_matches_updated_at
  before update on public.matches
  for each row execute function public.update_updated_at_column();

-- Realtime
alter publication supabase_realtime add table public.matchmaking_queue;
alter publication supabase_realtime add table public.matches;
alter table public.matches replica identity full;
alter table public.matchmaking_queue replica identity full;

-- Join matchmaking: pair with someone waiting, else queue
create or replace function public.join_matchmaking()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _user_id uuid := auth.uid();
  _opponent record;
  _match_id uuid;
  _my_name text;
  _opp_name text;
  _is_white_user boolean;
begin
  if _user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Already in an active match? return it
  select id into _match_id from public.matches
    where status = 'active' and (white_id = _user_id or black_id = _user_id)
    limit 1;
  if _match_id is not null then
    return _match_id;
  end if;

  -- Try to find waiting opponent (lock row)
  select q.* into _opponent from public.matchmaking_queue q
    where q.user_id <> _user_id
    order by q.created_at asc
    for update skip locked
    limit 1;

  select display_name into _my_name from public.profiles where user_id = _user_id;

  if _opponent.user_id is not null then
    select display_name into _opp_name from public.profiles where user_id = _opponent.user_id;
    -- random color
    _is_white_user := (random() < 0.5);
    insert into public.matches(white_id, black_id, white_name, black_name)
      values (
        case when _is_white_user then _user_id else _opponent.user_id end,
        case when _is_white_user then _opponent.user_id else _user_id end,
        case when _is_white_user then _my_name else _opp_name end,
        case when _is_white_user then _opp_name else _my_name end
      )
      returning id into _match_id;
    delete from public.matchmaking_queue where user_id = _opponent.user_id;
    -- ensure self not still queued
    delete from public.matchmaking_queue where user_id = _user_id;
    return _match_id;
  else
    insert into public.matchmaking_queue(user_id) values (_user_id)
      on conflict (user_id) do nothing;
    return null;
  end if;
end;
$$;

-- Make a move
create or replace function public.make_match_move(_match_id uuid, _fen text, _move_san text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _user_id uuid := auth.uid();
  _m public.matches%rowtype;
  _turn char(1);
  _expected uuid;
begin
  if _user_id is null then raise exception 'Not authenticated'; end if;

  select * into _m from public.matches where id = _match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if _m.status <> 'active' then raise exception 'Match is over'; end if;

  _turn := split_part(_m.fen, ' ', 2);
  _expected := case when _turn = 'w' then _m.white_id else _m.black_id end;
  if _expected <> _user_id then raise exception 'Not your turn'; end if;

  update public.matches
    set fen = _fen,
        moves = moves || to_jsonb(_move_san)
    where id = _match_id;
end;
$$;

-- Finish match and settle coins
create or replace function public.finish_match(_match_id uuid, _result text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _user_id uuid := auth.uid();
  _m public.matches%rowtype;
  _winner uuid;
  _loser uuid;
begin
  if _user_id is null then raise exception 'Not authenticated'; end if;
  if _result not in ('white','black','draw') then raise exception 'Invalid result'; end if;

  select * into _m from public.matches where id = _match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if _m.status = 'finished' then return; end if;
  if _user_id <> _m.white_id and _user_id <> _m.black_id then
    raise exception 'Not a player';
  end if;

  if _result = 'white' then
    _winner := _m.white_id; _loser := _m.black_id;
  elsif _result = 'black' then
    _winner := _m.black_id; _loser := _m.white_id;
  end if;

  update public.matches
    set status = 'finished',
        result = _result,
        winner_id = _winner,
        finished_at = now()
    where id = _match_id;

  if _result <> 'draw' then
    update public.profiles set coins = coins + 10 where user_id = _winner;
    update public.profiles set coins = greatest(coins - 10, 0) where user_id = _loser;
    insert into public.coin_transactions(user_id, amount, reason, metadata)
      values (_winner, 10, 'multiplayer_win', jsonb_build_object('match_id', _match_id));
    insert into public.coin_transactions(user_id, amount, reason, metadata)
      values (_loser, -10, 'multiplayer_loss', jsonb_build_object('match_id', _match_id));
  end if;
end;
$$;