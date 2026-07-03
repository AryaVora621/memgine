// Embedding service for MemPalace hybrid recall.
// Uses Supabase's built-in gte-small model (384 dims): no external API keys,
// mirroring mempalace's local-first retrieval design.
//
// Modes:
//   { text }              -> { embedding: number[] }  (query embedding at chat time)
//   { ids: [...] }        -> embed those project_memories rows, store on the row
//   { backfill: true }    -> embed every row whose embedding is NULL
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const session = new Supabase.ai.Session('gte-small');

// Browser clients invoke this directly, so answer CORS preflight.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function embedText(text: string): Promise<number[]> {
  const output = await session.run(text.slice(0, 8000), { mean_pool: true, normalize: true });
  return Array.from(output as number[]);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    const { text, ids, backfill } = await req.json();

    if (typeof text === 'string' && text.trim()) {
      return json({ embedding: await embedText(text) });
    }

    if (!Array.isArray(ids) && backfill !== true) {
      return json({ error: 'Provide text, ids, or backfill' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    let query = supabase
      .from('project_memories')
      .select('id, name, description, fact_content');
    query = Array.isArray(ids) ? query.in('id', ids) : query.is('embedding', null);

    const { data, error } = await query;
    if (error) return json({ error: error.message }, 500);

    let embedded = 0;
    for (const row of data ?? []) {
      const source = [row.name, row.description, row.fact_content].filter(Boolean).join('\n');
      const embedding = await embedText(source);
      const { error: upErr } = await supabase
        .from('project_memories')
        .update({ embedding: JSON.stringify(embedding) })
        .eq('id', row.id);
      if (!upErr) embedded++;
    }

    return json({ embedded });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'unknown' }, 500);
  }
});
