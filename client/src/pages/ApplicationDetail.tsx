import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, FileText, Calendar, User, AlertTriangle, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { GuideApplication, GuideApplicationApproval, ApplicationStatus, AdminActionType } from "@/types/admin";
import { isUnauthorizedError } from "@/lib/authUtils";

export default function ApplicationDetail() {
  const [, params] = useRoute("/verifier-management/application/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [note, setNote] = useState("");
  const [selectedAction, setSelectedAction] = useState<AdminActionType | "">("");
  const [isReadOnly, setIsReadOnly] = useState(false);

  const applicationId = params?.id;

  // Check if readonly mode from URL params
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    setIsReadOnly(urlParams.get('readonly') === 'true');
  }, []);

  // Fetch application details
  const { data: application, isLoading: applicationLoading } = useQuery<GuideApplication>({
    queryKey: ["/api/guide-applications", applicationId],
    enabled: !!applicationId,
    retry: false,
  });

  // Fetch approval history
  const { data: approvals = [], isLoading: approvalsLoading } = useQuery<GuideApplicationApproval[]>({
    queryKey: ["/api/guide-applications", applicationId, "approvals"],
    enabled: !!applicationId,
    retry: false,
  });

  // Submit approval mutation
  const submitApprovalMutation = useMutation({
    mutationFn: async ({ action, note }: { action: AdminActionType; note: string }) => {
      if (!applicationId) throw new Error("Application ID is required");
      
      await apiRequest("POST", "/api/guide-approvals", {
        applicationId,
        userId: application?.userId || 0,
        adminAction: action,
        note: note.trim() || null
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/guide-applications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/guide-approvals"] });
      toast({
        title: "Success",
        description: "Application approval submitted successfully",
      });
      // Navigate back to verifier management
      setLocation("/verifier-management");
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: "Failed to submit approval",
        variant: "destructive",
      });
    },
  });

  const handleSubmitApproval = () => {
    if (!selectedAction) {
      toast({
        title: "Error",
        description: "Please select an action",
        variant: "destructive",
      });
      return;
    }

    if (selectedAction === "require_more_info" && !note.trim()) {
      toast({
        title: "Error", 
        description: "Please provide a note when requiring more information",
        variant: "destructive",
      });
      return;
    }

    submitApprovalMutation.mutate({ action: selectedAction, note });
  };

  const getStatusBadge = (status: ApplicationStatus) => {
    const colors = {
      pending: "bg-blue-500/10 text-blue-700",
      needs_more_info: "bg-yellow-500/10 text-yellow-700", 
      approved: "bg-green-500/10 text-green-700",
      rejected: "bg-red-500/10 text-red-700",
      drafted: "bg-gray-500/10 text-gray-700"
    } as const;

    return (
      <span className={`px-2 py-1 rounded-full text-sm font-medium ${colors[status] || 'bg-gray-100 text-gray-700'}`}>
        {status.replace('_', ' ')}
      </span>
    );
  };

  const getActionBadge = (action: AdminActionType) => {
    const colors = {
      review: "bg-blue-500/10 text-blue-700",
      approve: "bg-green-500/10 text-green-700",
      reject: "bg-red-500/10 text-red-700",
      require_more_info: "bg-yellow-500/10 text-yellow-700"
    } as const;

    return (
      <span className={`px-2 py-1 rounded-full text-sm font-medium ${colors[action] || 'bg-gray-100 text-gray-700'}`}>
        {action.replace('_', ' ')}
      </span>
    );
  };

  if (applicationLoading || approvalsLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4 mb-8">
          <Button variant="ghost" onClick={() => setLocation("/verifier-management")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <h1 className="text-3xl font-light text-foreground">Loading Application...</h1>
        </div>
      </div>
    );
  }

  if (!application) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4 mb-8">
          <Button variant="ghost" onClick={() => setLocation("/verifier-management")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <h1 className="text-3xl font-light text-foreground">Application Not Found</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Button variant="ghost" onClick={() => setLocation("/verifier-management")} data-testid="button-back">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div className="flex-1">
          <h1 className="text-3xl font-light text-foreground mb-2" data-testid="text-application-detail-title">
            Application Review: {application.name}
          </h1>
          <p className="text-muted-foreground">
            Application ID: {application.id}
          </p>
        </div>
        {application.flaggedForReview && (
          <div className="flex items-center gap-2 text-yellow-600">
            <AlertTriangle className="h-5 w-5" />
            <span className="text-sm font-medium">Flagged for Review</span>
          </div>
        )}
      </div>

      {/* Application Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Application Information</span>
            {getStatusBadge(application.applicationStatus)}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Applicant Name</p>
              <p className="text-lg" data-testid="text-applicant-name">{application.name}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">User ID</p>
              <p className="text-lg" data-testid="text-user-id">{application.userId}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Created</p>
              <p className="text-lg">{new Date(application.createdAt).toLocaleDateString()}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Last Updated</p>
              <p className="text-lg">{new Date(application.updatedAt).toLocaleDateString()}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* PDF Documents */}
      {application.internalTags && application.internalTags.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Application Documents
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {application.internalTags.map((pdfUrl, index) => (
              <div key={index} className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="font-medium">Document {index + 1}</h4>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => window.open(pdfUrl, '_blank')}
                    data-testid={`button-open-pdf-${index}`}
                  >
                    <FileText className="h-4 w-4 mr-2" />
                    Open PDF
                  </Button>
                </div>
                
                {/* PDF Embed */}
                <div className="w-full h-96 border rounded">
                  <iframe
                    src={pdfUrl}
                    className="w-full h-full rounded"
                    title={`Application Document ${index + 1}`}
                    data-testid={`iframe-pdf-${index}`}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Approval History */}
      {approvals.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Approval History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {approvals.map((approval) => (
                <div key={approval.id} className="flex items-start gap-4 p-4 border rounded-lg">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      {approval.adminAction && getActionBadge(approval.adminAction)}
                      <span className="text-sm text-muted-foreground">
                        {new Date(approval.createdAt).toLocaleString()}
                      </span>
                    </div>
                    {approval.note && (
                      <p className="text-sm">{approval.note}</p>
                    )}
                    {approval.userResponse && (
                      <div className="mt-2 p-2 bg-muted rounded text-sm">
                        <p className="font-medium">User Response:</p>
                        <p>{JSON.stringify(approval.userResponse)}</p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Approval Actions - Only show for pending applications in non-readonly mode */}
      {!isReadOnly && (application.applicationStatus === 'pending' || application.applicationStatus === 'needs_more_info') && (
        <Card>
          <CardHeader>
            <CardTitle>Review Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground">Review Note</label>
              <Textarea
                placeholder="Enter your review notes here..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="mt-2"
                rows={4}
                data-testid="textarea-review-note"
              />
            </div>
            
            <div>
              <label className="text-sm font-medium text-muted-foreground">Action</label>
              <Select value={selectedAction} onValueChange={(value) => setSelectedAction(value as AdminActionType)}>
                <SelectTrigger className="mt-2" data-testid="select-admin-action">
                  <SelectValue placeholder="Select an action..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="approve">Approve Application</SelectItem>
                  <SelectItem value="reject">Reject Application</SelectItem>
                  <SelectItem value="require_more_info">Require More Information</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={handleSubmitApproval}
              disabled={!selectedAction || submitApprovalMutation.isPending}
              className="w-full"
              data-testid="button-submit-approval"
            >
              <Send className="h-4 w-4 mr-2" />
              {submitApprovalMutation.isPending ? "Submitting..." : "Submit Review"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}