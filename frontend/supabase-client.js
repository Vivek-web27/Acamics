import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://axceorzwzfuyuaeoswgv.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_hZPUC-ejVolPLx8_O7YktA_G4BTiejk";

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);
