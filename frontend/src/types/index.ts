// ─── Enums ────────────────────────────────────────────────────────────────────

export type UserRole =
  | 'admin'
  | 'supervisor'
  | 'branch_manager'
  | 'scaler'
  | 'mixer'
  | 'baker'
  | 'repacker';

export type DoughType =
  | 'lean_hard_yeast'
  | 'enriched_yeast'
  | 'tangzhong'
  | 'batter_quick_mix';

export type MixerTeam = 'team_a' | 'team_b' | 'team_c';

export type OrderStatus =
  | 'pending'
  | 'approved'
  | 'in_production'
  | 'packed'
  | 'delivered'
  | 'rejected'
  | 'expired';

export type TaskStatus = 'pending' | 'in_progress' | 'completed';
export type TaskRole = 'scaling' | 'mixing' | 'baking' | 'repacking';

// ─── Entities ─────────────────────────────────────────────────────────────────

export interface Branch {
  id: string;
  name: string;
  address: string | null;
  contact: string | null;
  is_active: boolean;
  created_at: string;
}

export interface User {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  branch_id: string | null;
  mixer_team: MixerTeam | null;
  is_active: boolean;
  branches?: Branch;
  created_at: string;
}

export interface Ingredient {
  id: string;
  name: string;
  unit: string;
  current_stock_g: number;
  reorder_threshold_g: number;
  stock_status?: string;
  computed_status?: string;
}

export interface RecipeIngredient {
  id: string;
  product_id: string;
  ingredient_id: string;
  amount_value?: number;
  amount_display?: string | null;
  amount_unit?: string | null;
  amount_g: number;
  notes: string | null;
  is_optional: boolean;
  ingredients?: Ingredient;
  total_amount_g?: number; // computed: amount_g * batches
}

export interface Product {
  id: string;
  name: string;
  dough_type: DoughType;
  base_yield_qty: number;
  yield_unit: string;
  oven_temp_c: number | null;
  bake_time_min: number | null;
  is_active: boolean;
  recipe_ingredients?: RecipeIngredient[];
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  batches: number;
  products?: Product;
}

export interface Order {
  id: string;
  branch_id: string;
  placed_by: string;
  delivery_date: string;
  work_day?: string | null;
  is_special: boolean;
  special_notes: string | null;
  status: OrderStatus;
  approved_by: string | null;
  approved_at: string | null;
  expires_at: string | null;
  created_at: string;
  branches?: Branch;
  placed_by_user?: Pick<User, 'id' | 'full_name'>;
  approved_by_user?: Pick<User, 'id' | 'full_name'>;
  order_items?: OrderItem[];
}

export interface ProductionPlan {
  id: string;
  production_date: string;
  generated_by: string;
  generated_at: string;
  is_finalized: boolean;
  notes: string | null;
  production_plan_items?: ProductionPlanItem[];
}

// Extended plan type used by some UI pages which include related orders or delivery metadata
export interface PlanWithOrders extends ProductionPlan {
  // delivery_date is the day when orders are delivered (work day + 1)
  delivery_date?: string;
  // optional related orders for that delivery date
  orders?: Order[];
}
export interface ProductionPlanItem {
  id: string;
  plan_id: string;
  product_id: string;
  total_batches: number;
  products?: Product;
  tasks?: Task[];
}

export interface Task {
  id: string;
  plan_item_id: string;
  assigned_to: string;
  task_role: TaskRole;
  batches_assigned: number;
  status: TaskStatus;
  is_priority: boolean;
  started_at: string | null;
  completed_at: string | null;
  notes: string | null;
  assigned_user?: Pick<User, 'id' | 'full_name' | 'role' | 'mixer_team'>;
  production_plan_items?: ProductionPlanItem;
  ingredient_list?: (RecipeIngredient & { total_amount_g: number })[];
}

export interface AssignRow {
  user_id: string;
  batches: number;
}

// ─── Ingredient Engine ────────────────────────────────────────────────────────

export interface IngredientRequirement {
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  required_g: number;
  available_g: number;
  shortage_g: number;
  is_sufficient: boolean;
  is_optional: boolean;
}

export interface IngredientEngineResult {
  pull_list: IngredientRequirement[];
  shortage_list: IngredientRequirement[];
  has_shortages: boolean;
  total_products: number;
  total_batches: number;
}

// ─── Load Balance ─────────────────────────────────────────────────────────────

export interface WorkerLoad {
  user_id: string;
  full_name: string;
  batches_assigned: number;
  is_overloaded: boolean;
  is_underloaded: boolean;
  load_percentage: number;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  branch_id: string | null;
  mixer_team: MixerTeam | null;
  full_name: string;
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────

export const DOUGH_TYPE_LABELS: Record<DoughType, string> = {
  lean_hard_yeast: 'Lean / Hard Yeast',
  enriched_yeast:  'Enriched Yeast',
  tangzhong:       'Tangzhong',
  batter_quick_mix:'Batter / Quick Mix',
};

export const MIXER_TEAM_LABELS: Record<MixerTeam, string> = {
  team_a: 'Team A — Lean/Hard Yeast',
  team_b: 'Team B — Enriched & Tangzhong',
  team_c: 'Team C — Batter/Quick Mix',
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending:      'Pending',
  approved:     'Approved',
  in_production:'In Production',
  packed:       'Packed',
  delivered:    'Delivered',
  rejected:     'Rejected',
  expired:      'Expired',
};

export const ROLE_LABELS: Record<UserRole, string> = {
  admin:          'Admin',
  supervisor:     'Supervisor',
  branch_manager: 'Branch Manager',
  scaler:         'Scaler',
  mixer:          'Mixer',
  baker:          'Baker',
  repacker:       'Repacker',
};

export const ROLE_ROUTES: Record<UserRole, string> = {
  admin:          '/admin',
  supervisor:     '/supervisor',
  branch_manager: '/branch',
  scaler:         '/scaler',
  mixer:          '/mixer',
  baker:          '/baker',
  repacker:       '/repacker',
};
