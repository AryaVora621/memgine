import { createClient } from '@supabase/supabase-js';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.log("No Supabase env vars");
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);
const { data, error } = await supabase.from('projects').insert({
  id: "d414e21a-1111-4444-8888-123456789abc",
  name: "TEST_PROJ_2",
  path: "",
  user_id: "00000000-0000-0000-0000-000000000000"
});
console.log("TEST PROJ:", error);
