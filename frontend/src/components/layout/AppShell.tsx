import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Package,
  FlaskConical,
  Building2,
  ClipboardList,
  ShoppingCart,
  Calendar,
  Scale,
  Blend,
  FlameKindling,
  PackageCheck,
  ScrollText,
  ChevronRight,
  LogOut,
  Menu,
  X,
  Bell,
  Star,
  AlertTriangle,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import type React from 'react';
import { useAuth } from '../../hooks/useAuth';
import type { UserRole } from '../../types';

interface NavSection {
  label: string;
  items: { to: string; label: string; icon: React.ReactNode; badge?: number }[];
}

function getNavSections(role: UserRole, _basePath: string): NavSection[] {
  switch (role) {
    case 'admin':
      return [
        {
          label: 'Overview',
          items: [{ to: '/admin', label: 'Dashboard', icon: <LayoutDashboard size={16} /> }],
        },
        {
          label: 'Management',
          items: [
            { to: '/admin/users', label: 'Users', icon: <Users size={16} /> },
            { to: '/admin/branches', label: 'Branches', icon: <Building2 size={16} /> },
            { to: '/admin/products', label: 'Products', icon: <Package size={16} /> },
            { to: '/admin/ingredients', label: 'Ingredients', icon: <FlaskConical size={16} /> },
          ],
        },
        {
          label: 'System',
          items: [{ to: '/admin/logs', label: 'System Logs', icon: <ScrollText size={16} /> }],
        },
      ];

    case 'supervisor':
      return [
        {
          label: 'Overview',
          items: [{ to: '/supervisor', label: 'Dashboard', icon: <LayoutDashboard size={16} /> }],
        },
        {
          label: 'Operations',
          items: [
            {
              to: '/supervisor/status',
              label: 'Production Status',
              icon: <LayoutDashboard size={15} />,
            },
            { to: '/supervisor/specialties', label: 'Worker Specialties', icon: <Star size={15} /> },
            { to: '/supervisor/issues', label: 'Issue Tracker', icon: <AlertTriangle size={15} /> },
            { to: '/supervisor/orders', label: 'Order Inbox', icon: <ClipboardList size={16} /> },
            { to: '/supervisor/assign', label: 'Task Assignment', icon: <Users size={16} /> },
          ],
        },
      ];

    case 'branch_manager':
      return [
        {
          label: 'Orders',
          items: [
            { to: '/branch', label: 'Dashboard', icon: <LayoutDashboard size={16} /> },
            { to: '/branch/order/new', label: 'Place Order', icon: <ShoppingCart size={16} /> },
            { to: '/branch/history', label: 'Order History', icon: <Calendar size={16} /> },
          ],
        },
      ];

    case 'scaler':
      return [
        {
          label: 'My Work',
          items: [{ to: '/scaler', label: 'My Tasks', icon: <Scale size={16} /> }],
        },
      ];

    case 'mixer':
      return [
        {
          label: 'My Work',
          items: [{ to: '/mixer', label: 'My Tasks', icon: <Blend size={16} /> }],
        },
      ];

    case 'baker':
      return [
        {
          label: 'My Work',
          items: [{ to: '/baker', label: 'My Tasks', icon: <FlameKindling size={16} /> }],
        },
      ];

    case 'repacker':
      return [
        {
          label: 'My Work',
          items: [{ to: '/repacker', label: 'Packing Queue', icon: <PackageCheck size={16} /> }],
        },
      ];

    default:
      return [];
  }
}

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  supervisor: 'Supervisor',
  branch_manager: 'Branch Mgr',
  scaler: 'Scaler',
  mixer: 'Mixer',
  baker: 'Baker',
  repacker: 'Repacker',
};

// Sample branches for the selector - in real app this would come from API
const BRANCHES = ['Trinidad', 'Tagbilaran', 'Calape', 'Panglao / Gallares'];

function Clock() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return <div className="clock">{time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>;
}

export default function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState(BRANCHES[0]);

  if (!user) return null;

  const navSections = getNavSections(user.role, '');

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Brand - Design System */}
      <div className="px-4 pt-4 pb-6 border-b border-white/10 flex flex-col items-center text-center gap-1">
        <div className="w-48 h-auto flex-shrink-0 flex items-center justify-center">
          <img
            src="/assets/shopperlogo.png"
            alt="Bakery Production Management logo"
            className="w-full h-auto object-contain"
          />
        </div>
        <div>
          <p className="font-display text-base font-semibold text-white leading-tight">Bakery Production Management</p>
        </div>
      </div>

      {/* Nav - Design System */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {navSections.map((section) => (
          <div key={section.label} className="mb-4">
            <p className="px-3 mb-2 text-xs font-semibold uppercase tracking-widest text-blue-300 font-body">{section.label}</p>
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to.split('/').length <= 2}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''} group`}
                onClick={() => setSidebarOpen(false)}
              >
                <span className="flex-shrink-0">{item.icon}</span>
                <span className="flex-1">{item.label}</span>
                {item.badge ? (
                  <span
                    className={`nav-item-badge ${item.badge ? 'nav-item-badge-active' : 'nav-item-badge-default'}`}
                  >
                    {item.badge}
                  </span>
                ) : (
                  <ChevronRight size={13} className="opacity-0 group-hover:opacity-40 transition-opacity text-blue-200" />
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* User profile footer - Design System */}
      <div className="border-t border-white/10 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white font-display text-sm font-semibold flex-shrink-0">
            {user.full_name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white truncate font-body">{user.full_name}</p>
            <span className="text-xs text-blue-200 font-body">{ROLE_LABELS[user.role]}</span>
          </div>
          <button
            onClick={handleLogout}
            className="p-1.5 rounded-lg text-blue-300 hover:bg-white/10 hover:text-white transition-colors"
            title="Log out"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-blue-50">
      {/* Desktop Sidebar - Design System */}
      <aside className="hidden lg:flex flex-col w-[320px] bg-gradient-to-b from-blue-950 to-blue-900 flex-shrink-0 sticky top-0 h-screen">
        <SidebarContent />
      </aside>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-[320px] bg-gradient-to-b from-blue-950 to-blue-900 flex flex-col shadow-card-lg">
            <button
              className="absolute top-3 right-3 p-1 rounded-lg text-blue-200 hover:text-white"
              onClick={() => setSidebarOpen(false)}
            >
              <X size={18} />
            </button>
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main area */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Topbar - Design System */}
        <header className="h-14 bg-white border-b border-border flex items-center px-5 gap-4 flex-shrink-0">
          <button
            className="lg:hidden p-2 rounded-lg text-slate-600 hover:bg-blue-50"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={18} />
          </button>

          {/* Page title area - pages can override via portal */}
          <div className="flex-1" id="breadcrumb-portal" />

          {/* Right section - Design System */}
          <div className="flex items-center gap-3">
            {/* Branch Selector */}
            <button className="branch-selector">
              <span className="branch-selector-dot" />
              <span className="font-body text-sm">{selectedBranch}</span>
              <ChevronRight size={14} className="rotate-90 text-slate-400" />
            </button>

            {/* Clock */}
            <Clock />

            {/* Notification Button */}
            <button className="btn-icon relative">
              <Bell size={16} />
            </button>

            {/* Avatar */}
            <div className="avatar">{user.full_name.charAt(0).toUpperCase()}</div>
          </div>
        </header>

        {/* Page content - Design System */}
        <main className="flex-1 overflow-y-auto p-5 lg:p-7">
          <div className="max-w-[1400px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

