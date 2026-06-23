import { useParams } from "wouter";
import OfferLetterBuilder from "@/components/offerLetter/OfferLetterBuilder";

export default function OfferLetterBuilderPage() {
  const params = useParams();
  const adminId = params.id ? Number(params.id) : NaN;

  if (!Number.isFinite(adminId)) {
    return (
      <div className="space-y-2">
        <h1 className="text-3xl font-light text-foreground">Offer Letter Builder</h1>
        <p className="text-muted-foreground">Admin profile id is missing.</p>
      </div>
    );
  }

  return <OfferLetterBuilder adminId={adminId} />;
}
