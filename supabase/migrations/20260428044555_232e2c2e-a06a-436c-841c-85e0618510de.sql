
-- Profiles
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  coins integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy "Profiles viewable by authenticated"
  on public.profiles for select
  to authenticated
  using (true);

create policy "Users update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = user_id);

create policy "Users insert own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Coin transactions
create table public.coin_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount integer not null,
  reason text not null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.coin_transactions enable row level security;

create policy "Users view own coin transactions"
  on public.coin_transactions for select
  to authenticated
  using (auth.uid() = user_id);

create index on public.coin_transactions(user_id, created_at desc);

-- Shop items
create table public.shop_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null,
  category text not null,
  price integer not null check (price > 0),
  image_emoji text not null default '🎁',
  in_stock boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.shop_items enable row level security;

create policy "Shop items viewable by authenticated"
  on public.shop_items for select
  to authenticated
  using (true);

-- Orders
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  shop_item_id uuid not null references public.shop_items(id),
  item_name text not null,
  price_paid integer not null,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
alter table public.orders enable row level security;

create policy "Users view own orders"
  on public.orders for select
  to authenticated
  using (auth.uid() = user_id);

create index on public.orders(user_id, created_at desc);

-- updated_at trigger
create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.update_updated_at_column();

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Award coins (callable by client; locked to caller's own user_id)
create or replace function public.award_coins(_amount integer, _reason text, _metadata jsonb default '{}'::jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  _user_id uuid := auth.uid();
  _new_balance integer;
begin
  if _user_id is null then
    raise exception 'Not authenticated';
  end if;
  if _amount <= 0 or _amount > 10000 then
    raise exception 'Invalid amount';
  end if;

  update public.profiles
    set coins = coins + _amount
    where user_id = _user_id
    returning coins into _new_balance;

  insert into public.coin_transactions(user_id, amount, reason, metadata)
    values (_user_id, _amount, _reason, _metadata);

  return _new_balance;
end;
$$;

-- Purchase shop item (atomic deduct + order)
create or replace function public.purchase_shop_item(_item_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _user_id uuid := auth.uid();
  _item public.shop_items%rowtype;
  _balance integer;
  _order_id uuid;
begin
  if _user_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into _item from public.shop_items where id = _item_id and in_stock = true;
  if not found then
    raise exception 'Item unavailable';
  end if;

  select coins into _balance from public.profiles where user_id = _user_id for update;
  if _balance is null or _balance < _item.price then
    raise exception 'Insufficient coins';
  end if;

  update public.profiles set coins = coins - _item.price where user_id = _user_id;

  insert into public.orders(user_id, shop_item_id, item_name, price_paid)
    values (_user_id, _item.id, _item.name, _item.price)
    returning id into _order_id;

  insert into public.coin_transactions(user_id, amount, reason, metadata)
    values (_user_id, -_item.price, 'shop_purchase', jsonb_build_object('item_id', _item.id, 'item_name', _item.name, 'order_id', _order_id));

  return _order_id;
end;
$$;

-- Seed shop
insert into public.shop_items (name, description, category, price, image_emoji) values
  ('MacBook Pro 14"', 'Apple M3 chip, 16GB RAM, 512GB SSD. Perfect for chess study.', 'Electronics', 250000, '💻'),
  ('Tournament Chess Set', 'Wooden Staunton pieces with weighted base and roll-up board.', 'Chess Gear', 8000, '♟️'),
  ('Digital Chess Clock', 'Professional DGT-style timer with delay and increment modes.', 'Chess Gear', 4500, '⏱️'),
  ('Local Chess Tournament Ticket', 'Entry to the next open tournament near you.', 'Events', 2000, '🎟️'),
  ('Grandmaster Lecture Pass', 'Stream a live lecture from a titled player.', 'Events', 1500, '🎓'),
  ('Premium Coaching Session', 'One hour with a FIDE-rated coach over video.', 'Coaching', 6000, '👨‍🏫');
