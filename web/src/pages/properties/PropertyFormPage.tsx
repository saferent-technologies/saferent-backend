import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router";
import { z } from "zod";
import { PageHeader } from "@/components/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Select, Textarea } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@/hooks/useQuery";
import { request } from "@/services/api";
import { errorMessage } from "@/utils/errors";
import { toOptions } from "@/utils/format";
import { FURNISHING, PROPERTY_TYPES, type PropertyDetail } from "./types";

const num = (msg: string) => z.coerce.number({ message: msg });

const schema = z.object({
  title: z.string().trim().min(5, "At least 5 characters.").max(150),
  description: z.string().trim().min(20, "Describe the property in at least 20 characters.").max(5000),
  propertyType: z.enum(PROPERTY_TYPES),
  addressLine: z.string().trim().min(5, "Enter the address.").max(255),
  locality: z.string().trim().max(120).optional(),
  city: z.string().trim().min(2, "Enter the city.").max(80),
  state: z.string().trim().min(2, "Enter the state.").max(80),
  pincode: z.string().trim().regex(/^\d{6}$/, "Enter a 6-digit PIN code."),
  bedrooms: num("Enter a number.").int().min(0).max(20),
  bathrooms: num("Enter a number.").int().min(0).max(20),
  areaSqft: z.union([z.literal(""), num("Enter a number.").int().min(50).max(100000)]).optional(),
  furnishing: z.enum(FURNISHING),
  monthlyRent: num("Enter the monthly rent.").positive("Rent must be more than 0."),
  securityDeposit: num("Enter the deposit.").min(0),
  availableFrom: z.string().optional(),
  landlordPhone: z.string().trim().optional(),
});
type Values = z.input<typeof schema>;
type Output = z.output<typeof schema>;

export function PropertyFormPage() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const { data, loading } = useQuery(() => request<{ property: PropertyDetail }>(`/properties/${id}`), [id], editing);
  const needsLandlord = !editing && profile?.role !== "LANDLORD";

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Values, unknown, Output>({
    resolver: zodResolver(schema),
    defaultValues: { propertyType: "APARTMENT", furnishing: "UNFURNISHED", bedrooms: 1, bathrooms: 1, securityDeposit: 0 },
  });

  useEffect(() => {
    const p = data?.property;
    if (p) reset({ ...p, locality: p.locality ?? "", areaSqft: p.areaSqft ?? "", monthlyRent: Number(p.monthlyRent), securityDeposit: Number(p.securityDeposit), availableFrom: p.availableFrom?.slice(0, 10) ?? "" });
  }, [data, reset]);

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    if (needsLandlord && !/^\+[1-9]\d{7,14}$/.test(v.landlordPhone ?? "")) {
      setError("Enter the landlord's registered phone with country code, e.g. +919876543210.");
      return;
    }
    const body = {
      ...v,
      locality: v.locality || null,
      areaSqft: v.areaSqft === "" || v.areaSqft === undefined ? null : v.areaSqft,
      availableFrom: v.availableFrom || null,
      landlordPhone: needsLandlord ? v.landlordPhone : undefined,
    };
    try {
      if (editing) {
        await request(`/properties/${id}`, { method: "PATCH", body: { ...body, landlordPhone: undefined } });
        navigate(`/properties/${id}`);
      } else {
        const res = await request<{ property: { id: string } }>("/properties", { method: "POST", body });
        navigate(`/properties/${res.property.id}?created=1`);
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  if (editing && loading) return <div className="flex justify-center py-16"><Spinner className="size-7 text-brand" /></div>;

  return (
    <>
      <Link to={editing ? `/properties/${id}` : "/properties"} className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-dark hover:text-brand">
        <ArrowLeft className="size-4" /> Back
      </Link>
      <PageHeader title={editing ? "Edit property" : "Add property"} description={editing ? "Changing the title, address or rent of a live listing sends it back for review." : "Save as a draft, add photos, then submit for review."} />
      <form onSubmit={onSubmit} noValidate className="max-w-3xl space-y-6">
        {error && <Alert kind="error">{error}</Alert>}
        <section className="card space-y-4 p-5 sm:p-6">
          <h2 className="font-semibold">Basics</h2>
          {needsLandlord && <Input label="Landlord's registered phone" type="tel" placeholder="+919876543210" hint="The property is listed under this landlord's account." {...register("landlordPhone")} />}
          <Input label="Title" placeholder="2 BHK apartment near Metro" error={errors.title?.message} {...register("title")} />
          <Textarea label="Description" rows={5} error={errors.description?.message} {...register("description")} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Property type" options={toOptions(PROPERTY_TYPES)} {...register("propertyType")} />
            <Select label="Furnishing" options={toOptions(FURNISHING)} {...register("furnishing")} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Input label="Bedrooms" type="number" inputMode="numeric" min={0} error={errors.bedrooms?.message} {...register("bedrooms")} />
            <Input label="Bathrooms" type="number" inputMode="numeric" min={0} error={errors.bathrooms?.message} {...register("bathrooms")} />
            <Input label="Area (sq ft)" type="number" inputMode="numeric" min={0} error={errors.areaSqft?.message} {...register("areaSqft")} />
          </div>
        </section>
        <section className="card space-y-4 p-5 sm:p-6">
          <h2 className="font-semibold">Location</h2>
          <Input label="Address" error={errors.addressLine?.message} {...register("addressLine")} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Locality (optional)" {...register("locality")} />
            <Input label="City" error={errors.city?.message} {...register("city")} />
            <Input label="State" error={errors.state?.message} {...register("state")} />
            <Input label="PIN code" inputMode="numeric" maxLength={6} error={errors.pincode?.message} {...register("pincode")} />
          </div>
        </section>
        <section className="card space-y-4 p-5 sm:p-6">
          <h2 className="font-semibold">Rent</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Input label="Monthly rent (₹)" type="number" inputMode="numeric" min={0} error={errors.monthlyRent?.message} {...register("monthlyRent")} />
            <Input label="Security deposit (₹)" type="number" inputMode="numeric" min={0} error={errors.securityDeposit?.message} {...register("securityDeposit")} />
            <Input label="Available from" type="date" {...register("availableFrom")} />
          </div>
        </section>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => navigate(-1)}>Cancel</Button>
          <Button type="submit" loading={isSubmitting}>{editing ? "Save changes" : "Save draft"}</Button>
        </div>
      </form>
    </>
  );
}
