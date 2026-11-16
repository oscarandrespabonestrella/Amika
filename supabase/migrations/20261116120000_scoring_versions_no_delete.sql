-- 0009 Score sheet versions can no longer be deleted one by one.
-- Versions are immutable history (matches will reference them in Phase 5b). The delete
-- policy let an owner remove version N through the API and then insert a different
-- version N, silently rewriting history. Deleting a whole sheet still removes its
-- versions: foreign-key cascades run as the table owner and do not need this policy.

drop policy scoring_sheet_versions_delete_own on public.scoring_sheet_versions;
