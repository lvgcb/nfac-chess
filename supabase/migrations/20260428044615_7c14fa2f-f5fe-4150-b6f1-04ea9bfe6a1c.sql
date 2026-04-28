
revoke execute on function public.award_coins(integer, text, jsonb) from public, anon;
revoke execute on function public.purchase_shop_item(uuid) from public, anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.update_updated_at_column() from public, anon, authenticated;

grant execute on function public.award_coins(integer, text, jsonb) to authenticated;
grant execute on function public.purchase_shop_item(uuid) to authenticated;
