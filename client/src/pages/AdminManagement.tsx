import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Plus, Search } from "lucide-react";
import { AdminUser, ROLE_DISPLAY_NAMES } from "@/types/admin";

export default function AdminManagement() {
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: admins = [], isLoading } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
    retry: false,
  });

  const filteredAdmins = admins.filter(admin => {
    const matchesSearch = admin.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         admin.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRole = roleFilter === "all" || admin.role === roleFilter;
    const matchesStatus = statusFilter === "all" || admin.status === statusFilter;
    
    return matchesSearch && matchesRole && matchesStatus;
  });

  const getStatusBadge = (status: string) => {
    const variants = {
      active: "default",
      pending: "secondary", 
      inactive: "destructive",
      rejected: "destructive",
    } as const;
    
    return (
      <Badge variant={variants[status as keyof typeof variants] || "secondary"}>
        {status}
      </Badge>
    );
  };

  const getRoleBadge = (role: string) => {
    const colors = {
      super_admin: "bg-primary/10 text-primary",
      admin_finance: "bg-blue-500/10 text-blue-700",
      admin_verifier: "bg-green-500/10 text-green-700",
      admin_support: "bg-orange-500/10 text-orange-700",
    } as const;

    return (
      <span className={`px-2 py-1 rounded-full text-sm ${colors[role as keyof typeof colors] || 'bg-gray-100 text-gray-700'}`}>
        {ROLE_DISPLAY_NAMES[role as keyof typeof ROLE_DISPLAY_NAMES] || role}
      </span>
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="mb-8 flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-light text-foreground mb-2">Admin Management</h1>
            <p className="text-muted-foreground">Loading admin users...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="mb-8 flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-light text-foreground mb-2" data-testid="text-admin-management-title">
            Admin Management
          </h1>
          <p className="text-muted-foreground">
            Manage administrator accounts and permissions.
          </p>
        </div>
        <Link href="/admin-management/create">
          <Button data-testid="button-create-admin">
            <Plus className="h-4 w-4 mr-2" />
            Create New Admin
          </Button>
        </Link>
      </div>

      {/* Search and Filter */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4 items-center">
            <div className="relative flex-1 min-w-64">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search admins..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
                data-testid="input-search-admins"
              />
            </div>
            
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-40" data-testid="select-role-filter">
                <SelectValue placeholder="All Roles" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                <SelectItem value="super_admin">Super Admin</SelectItem>
                <SelectItem value="admin_finance">Finance Admin</SelectItem>
                <SelectItem value="admin_verifier">Verifier Admin</SelectItem>
                <SelectItem value="admin_support">Support Admin</SelectItem>
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40" data-testid="select-status-filter">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Admin List */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left p-4 font-medium text-foreground">Admin</th>
                  <th className="text-left p-4 font-medium text-foreground">Role</th>
                  <th className="text-left p-4 font-medium text-foreground">Status</th>
                  <th className="text-left p-4 font-medium text-foreground">Last Login</th>
                  <th className="text-left p-4 font-medium text-foreground">Created</th>
                  <th className="text-left p-4 font-medium text-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAdmins.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-muted-foreground" data-testid="text-no-admins">
                      {searchTerm || roleFilter !== "all" || statusFilter !== "all" 
                        ? "No admins found matching your filters."
                        : "No admin users found."
                      }
                    </td>
                  </tr>
                ) : (
                  filteredAdmins.map((admin) => (
                    <tr 
                      key={admin.id} 
                      className="border-b border-border hover:bg-accent/50 cursor-pointer"
                      data-testid={`row-admin-${admin.id}`}
                    >
                      <td className="p-4">
                        <Link href={`/admin-management/profile/${admin.id}`} className="flex items-center space-x-3">
                          <Avatar>
                            <AvatarFallback className="bg-primary text-primary-foreground">
                              {admin.name[0]}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="font-medium" data-testid={`text-admin-name-${admin.id}`}>
                              {admin.name}
                            </div>
                            <div className="text-sm text-muted-foreground" data-testid={`text-admin-email-${admin.id}`}>
                              {admin.email}
                            </div>
                          </div>
                        </Link>
                      </td>
                      <td className="p-4">
                        {getRoleBadge(admin.role)}
                      </td>
                      <td className="p-4">
                        {getStatusBadge(admin.status)}
                      </td>
                      <td className="p-4" data-testid={`text-last-login-${admin.id}`}>
                        {admin.lastLoginAt 
                          ? new Date(admin.lastLoginAt).toLocaleDateString() 
                          : 'Never'
                        }
                      </td>
                      <td className="p-4" data-testid={`text-created-${admin.id}`}>
                        {new Date(admin.createdAt).toLocaleDateString()}
                      </td>
                      <td className="p-4">
                        <Link href={`/admin-management/profile/${admin.id}`}>
                          <Button variant="ghost" size="sm" data-testid={`button-view-admin-${admin.id}`}>
                            View
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
