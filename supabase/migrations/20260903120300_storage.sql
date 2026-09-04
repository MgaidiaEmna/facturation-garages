-- ===========================================================================
-- Phase 1 — Stockage des logos
--
-- Bucket PRIVÉ « logos », arborescence : {garage_id}/{fichier}.
-- Le premier segment du chemin porte l'isolation : un garage ne voit et
-- n'écrit que dans son propre dossier. Les images sont servies par URL
-- signée, jamais par URL publique.
-- ===========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'logos',
  'logos',
  false,                    -- privé : aucune lecture anonyme
  2097152,                  -- 2 Mio par fichier
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Note sécurité : un SVG peut embarquer du script. Il est accepté parce que
-- beaucoup de garages n'ont que ce format, mais il ne doit être rendu que
-- dans une balise <img> ou dans le PDF (contextes qui n'exécutent pas les
-- scripts), jamais injecté en ligne dans le DOM.

-- ---------------------------------------------------------------------------
-- Lecture : son propre dossier, ou tout pour l'administrateur
-- ---------------------------------------------------------------------------
create policy "logos_objects_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'logos'
    and (
      is_admin()
      or (storage.foldername(name))[1] = my_garage_id()::text
    )
  );

-- ---------------------------------------------------------------------------
-- Écriture : administrateur partout, garage « premium » dans son dossier
-- ---------------------------------------------------------------------------
-- Un garage standard ne téléverse rien : son logo lui est assigné par
-- l'administrateur.
create policy "logos_objects_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'logos'
    and (
      is_admin()
      or (
        (storage.foldername(name))[1] = my_garage_id()::text
        and can_manage_logos()
      )
    )
  );

create policy "logos_objects_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'logos'
    and (
      is_admin()
      or (
        (storage.foldername(name))[1] = my_garage_id()::text
        and can_manage_logos()
      )
    )
  )
  with check (
    bucket_id = 'logos'
    and (
      is_admin()
      or (
        (storage.foldername(name))[1] = my_garage_id()::text
        and can_manage_logos()
      )
    )
  );

create policy "logos_objects_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'logos'
    and (
      is_admin()
      or (
        (storage.foldername(name))[1] = my_garage_id()::text
        and can_manage_logos()
      )
    )
  );
