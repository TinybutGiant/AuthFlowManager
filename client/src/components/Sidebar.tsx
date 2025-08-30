import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  LayoutDashboard,
  Users,
  Check,
  BadgePlus,
  ArrowLeftRight,
  Delete,
  Wallet,
  UserRound,
  Bot,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { AdminRole } from "@/types/admin";

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

interface MenuItem {
  title: string;
  href?: string;
  icon: React.ElementType;
  roles: AdminRole[];
  badge?: number;
  children?: MenuItem[];
}

const menuItems: MenuItem[] = [
  {
    title: "LayoutDashboard",
    href: "/",
    icon: LayoutDashboard,
    roles: ['super_admin', 'admin_finance', 'admin_verifier', 'admin_support'],
  },
  {
    title: "Pending Requests",
    href: "/pending-requests",
    icon: Check,
    roles: ['super_admin'],
    badge: 3,
  },
  {
    title: "Admin Management",
    icon: Users,
    roles: ['super_admin'],
    children: [
      {
        title: "View All Admins",
        href: "/admin-management",
        icon: Users,
        roles: ['super_admin'],
      },
      {
        title: "Create Admin",
        href: "/admin-management/create",
        icon: BadgePlus,
        roles: ['super_admin'],
      },
      {
        title: "Change Role",
        href: "/admin-management/change-role",
        icon: ArrowLeftRight,
        roles: ['super_admin'],
      },
      {
        title: "Delete Admin",
        href: "/admin-management/delete",
        icon: Delete,
        roles: ['super_admin'],
      },
    ],
  },
  {
    title: "Finance Management",
    href: "/finance-management",
    icon: Wallet,
    roles: ['super_admin', 'admin_finance'],
  },
  {
    title: "Verifier Management",
    href: "/verifier-management", 
    icon: UserRound,
    roles: ['super_admin', 'admin_verifier'],
  },
  {
    title: "Support Management",
    href: "/support-management",
    icon: Bot,
    roles: ['super_admin', 'admin_support'],
  },
];

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { user } = useAuth();
  const [location] = useLocation();
  const [expandedSections, setExpandedSections] = useState<string[]>(['Admin Management']);
  
  const adminUser = (user as any)?.adminUser;
  const userRole = adminUser?.role as AdminRole;

  const toggleSection = (title: string) => {
    setExpandedSections(prev => 
      prev.includes(title)
        ? prev.filter(s => s !== title)
        : [...prev, title]
    );
  };

  const hasAccess = (roles: AdminRole[]) => {
    return userRole && roles.includes(userRole);
  };

  const renderMenuItem = (item: MenuItem) => {
    if (!hasAccess(item.roles)) return null;

    if (item.children) {
      const isExpanded = expandedSections.includes(item.title);
      return (
        <Collapsible key={item.title} open={isExpanded} onOpenChange={() => toggleSection(item.title)}>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="w-full justify-between p-3 text-left font-normal"
              data-testid={`button-section-${item.title.toLowerCase().replace(' ', '-')}`}
            >
              <div className="flex items-center space-x-3">
                <item.icon className="h-5 w-5" />
                <span>{item.title}</span>
              </div>
              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="ml-6 mt-2 space-y-1">
            {item.children.map(child => renderMenuItem(child))}
          </CollapsibleContent>
        </Collapsible>
      );
    }

    return (
      <Link key={item.href} href={item.href!}>
        <Button
          variant={location === item.href ? "secondary" : "ghost"}
          className={cn(
            "w-full justify-start p-3 text-left font-normal",
            location === item.href && "bg-accent text-accent-foreground"
          )}
          onClick={() => window.innerWidth < 1024 && onClose()}
          data-testid={`link-${item.title.toLowerCase().replace(' ', '-')}`}
        >
          <div className="flex items-center space-x-3 flex-1">
            <item.icon className="h-5 w-5" />
            <span>{item.title}</span>
          </div>
          {item.badge && (
            <span className="bg-destructive text-destructive-foreground text-xs px-2 py-1 rounded-full">
              {item.badge}
            </span>
          )}
        </Button>
      </Link>
    );
  };

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onClose}
          data-testid="sidebar-overlay"
        />
      )}
      
      {/* Sidebar */}
      <aside
        className={cn(
          "fixed left-0 top-16 z-50 h-[calc(100vh-4rem)] w-64 bg-card border-r border-border transition-transform lg:translate-x-0 lg:static lg:z-auto overflow-y-auto",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
        data-testid="sidebar"
      >
        <nav className="p-4 space-y-2">
          {menuItems.map(renderMenuItem)}
        </nav>
      </aside>
    </>
  );
}
