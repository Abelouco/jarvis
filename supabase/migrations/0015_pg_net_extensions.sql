-- Move o pg_net do schema public para o extensions (alerta "Extension in Public" do Supabase).
-- O pg_net não aceita `alter extension ... set schema`: precisa recriar. As funções dele
-- (net.http_post) continuam no schema `net`, então o job do vigia não muda; só some o
-- histórico de respostas em net._http_response, que é descartável.
select cron.unschedule('avisos_vigia') where exists (select 1 from cron.job where jobname = 'avisos_vigia');

drop extension if exists pg_net;
create extension pg_net with schema extensions;

select cron.schedule('avisos_vigia', '* * * * *', $cron$
  select net.http_post(
    url := 'https://pmqxeikcnuywvcxkeoep.supabase.co/functions/v1/avisos_vigia',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-vigia-chave', public.avisos_chave_vigia()),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
$cron$);
