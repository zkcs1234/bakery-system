const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const date = '2026-06-05';
  const { data, error } = await supabase
    .from('production_plans')
    .select(`
      *,
      production_plan_items (
        id, product_id, total_batches,
        products ( id, name, dough_type, base_yield_qty, yield_unit, oven_temp_c, bake_time_min )
      )
    `)
    .eq('production_date', date)
    .single();
  console.log('error=', error ? error.message : null);
  console.log('data=', JSON.stringify(data, null, 2));
})();
