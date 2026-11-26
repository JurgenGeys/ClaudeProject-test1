import { telHref } from "@/lib/phone";

/** `Bel kantoor op 014 00 00 00`, the number being a `tel:` link of at least 44 px high. */
export function CallOffice({ phone }: { phone: string }) {
  return (
    <>
      Bel kantoor op{" "}
      <a
        href={telHref(phone)}
        className="inline-flex min-h-11 items-center font-medium underline underline-offset-4"
      >
        {phone}
      </a>
      .
    </>
  );
}
