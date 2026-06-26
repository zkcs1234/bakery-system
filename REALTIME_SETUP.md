# Real-Time Data Sync Setup Guide

## Overview

The bakery system now uses **Supabase Real-Time Subscriptions** to automatically sync data when changes occur in the database. This means:

✅ When an ingredient is updated, the Ingredients page updates instantly  
✅ When a product is created, all managers see it immediately  
✅ No need to manually refresh or re-fetch data  
✅ Multiple users see changes in real-time without page refresh

## Environment Configuration

### Frontend Setup

1. **Create `.env.local` file in the `frontend/` directory:**

```env
VITE_API_URL=http://localhost:4000/api
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

2. **Get your Supabase credentials:**
   - Go to your Supabase project dashboard
   - Navigate to **Settings → API**
   - Copy the **Project URL** → paste to `VITE_SUPABASE_URL`
   - Copy the **Anon Key** → paste to `VITE_SUPABASE_ANON_KEY`

### Backend Setup

Ensure your backend `.env` has:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### Database Requirements

Real-time subscriptions require **Row Level Security (RLS)** to be enabled on tables. Ensure these tables have RLS enabled:

- `ingredients`
- `products`
- `branches`
- `users`
- `tasks`
- `orders`

**Enable RLS in Supabase:**

1. Go to **Authentication → Policies** in Supabase dashboard
2. Select each table and enable **RLS**
3. Configure policies to allow public `SELECT` (for the anon key)

## Architecture

### Real-Time Hooks

The system uses React hooks that handle:

1. **Initial data fetch** from Supabase
2. **Real-time subscriptions** to table changes
3. **Automatic state updates** when data changes

#### Available Hooks

```typescript
import {
  useRealtimeIngredients, // Ingredients with computed_status
  useRealtimeProducts, // Products with recipes
  useRealtimeBranches, // Branches list
  useRealtimeUsers, // Users with details
  useRealtimeTasks, // Tasks (ordered by date)
  useRealtimeOrders, // Orders (ordered by date)
  useRealtimeSubscription, // Generic hook for custom tables
} from "../hooks/useRealtimeData";
```

### Hook Usage Example

```typescript
function MyComponent() {
  const { ingredients, loading, error, isSubscribed } = useRealtimeIngredients();

  return (
    <div>
      {isSubscribed && <span>🟢 Live</span>}
      {loading && <p>Loading...</p>}
      {error && <p>Error: {error}</p>}
      {ingredients.map(ing => <div key={ing.id}>{ing.name}</div>)}
    </div>
  );
}
```

## Updated Pages

The following admin pages now use real-time data:

- **ManageIngredients** - Ingredients sync automatically
- **ManageProducts** - Products & recipes update live
- **ManageBranches** - Branch list updates in real-time
- **ManageUsers** - User list sync automatically

## Real-Time Indicators

Each page displays connection status:

```
🟢 Live       - Connected to real-time subscription
🔌 Connecting - Attempting to subscribe
```

## How It Works

### Event Types

The system subscribes to three event types:

1. **INSERT** - New record created
   - Added to the state array immediately
   - No duplicates

2. **UPDATE** - Record modified
   - Updated in the state array
   - Re-renders component

3. **DELETE** - Record removed
   - Filtered out from state array

### Example Flow

```
1. User A changes ingredient "Flour" from 1000g to 500g
2. Database is updated
3. Supabase sends UPDATE event to all subscribers
4. User B's browser receives the event
5. Component state automatically updates
6. User B sees "Flour: 500g" without refreshing
```

## Error Handling

If the real-time subscription fails:

1. Initial data is still loaded from HTTP
2. "Connecting..." indicator shows connection status
3. Users can still create/edit/delete (via API)
4. Automatic reconnection attempts occur

## Performance Notes

- Real-time subscriptions use WebSocket connections (efficient)
- Initial data fetch uses SQL queries (optimized)
- Only subscribed tables consume connection resources
- System supports unlimited concurrent connections

## Troubleshooting

### No "Live" indicator appearing

**Possible causes:**

1. `.env.local` not configured correctly
2. Supabase credentials are invalid
3. RLS not enabled on tables

**Solution:**

1. Verify `.env.local` has correct credentials
2. Check browser console for connection errors
3. Enable RLS on tables in Supabase dashboard

### Data not updating in real-time

**Possible causes:**

1. RLS policies blocking subscriptions
2. Network/firewall blocking WebSocket
3. Subscription not initialized

**Solution:**

1. Check Supabase RLS policies allow `SELECT`
2. Verify WebSocket connection in DevTools
3. Restart frontend dev server

### "Live" shows but changes don't appear

**Possible causes:**

1. Event not being sent by Supabase
2. State update logic has issues

**Solution:**

1. Check Supabase activity logs
2. Check browser console for errors
3. Verify hook is properly syncing state

## Adding Real-Time to New Pages

To add real-time data to a new page:

```typescript
import { useRealtimeIngredients } from '../../hooks/useRealtimeData';

export function MyPage() {
  const { ingredients, loading, error, isSubscribed } = useRealtimeIngredients();

  // Data automatically syncs when database changes
  return (
    <div>
      {ingredients.map(ing => <div key={ing.id}>{ing.name}</div>)}
    </div>
  );
}
```

## Custom Real-Time Subscriptions

For custom tables not covered by built-in hooks:

```typescript
import { useRealtimeSubscription } from "../../hooks/useRealtimeData";

const { isSubscribed } = useRealtimeSubscription(
  "your_table_name",
  (event, record) => {
    if (event === "INSERT") {
      /* handle insert */
    }
    if (event === "UPDATE") {
      /* handle update */
    }
    if (event === "DELETE") {
      /* handle delete */
    }
  },
);
```

## Testing Real-Time

1. Open page in **two browsers/tabs**
2. Make a change in one browser
3. Observe instant update in the other
4. No page refresh needed!

## Next Steps

- Monitor real-time performance in production
- Add more pages to real-time sync
- Consider adding real-time notifications for critical events
- Implement caching layer if needed for large datasets
