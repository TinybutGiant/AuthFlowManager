import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Bell, Menu, ChevronDown, Settings, LogOut } from "lucide-react";

interface TopBarProps {
  onToggleSidebar: () => void;
}

export default function TopBar({ onToggleSidebar }: TopBarProps) {
  const { user } = useAuth();
  const adminUser = (user as any)?.adminUser;

  const handleLogout = () => {
    window.location.href = "/api/logout";
  };

  return (
    <header className="bg-card border-b border-border h-16 flex items-center justify-between px-6 shadow-sm">
      <div className="flex items-center space-x-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleSidebar}
          className="lg:hidden"
          data-testid="button-toggle-sidebar"
        >
          <Menu className="h-5 w-5" />
        </Button>
        
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-primary rounded-md flex items-center justify-center">
            <Settings className="h-4 w-4 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-medium text-foreground">Admin Panel</h1>
          </div>
        </div>
      </div>

      <div className="flex items-center space-x-4">
        {/* Notifications */}
        <Button variant="ghost" size="icon" data-testid="button-notifications">
          <Bell className="h-5 w-5 text-muted-foreground" />
          <span className="absolute top-2 right-2 w-2 h-2 bg-destructive rounded-full"></span>
        </Button>

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center space-x-2" data-testid="button-user-menu">
              <Avatar className="w-8 h-8">
                <AvatarImage src={user?.profileImageUrl} />
                <AvatarFallback className="bg-primary text-primary-foreground">
                  {adminUser?.name?.[0] || user?.email?.[0] || '?'}
                </AvatarFallback>
              </Avatar>
              <div className="hidden sm:block text-left">
                <div className="text-sm font-medium text-foreground" data-testid="text-user-name">
                  {adminUser?.name || user?.email || 'Unknown'}
                </div>
                <div className="text-xs text-muted-foreground" data-testid="text-user-role">
                  {adminUser?.role || 'No Role'}
                </div>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem data-testid="menu-item-profile">
              <Settings className="mr-2 h-4 w-4" />
              Profile Settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleLogout} data-testid="menu-item-logout">
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
