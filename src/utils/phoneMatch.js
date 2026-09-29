import prisma from "../config/prismaClient";


export const digitsOnly = (s) => String(s || "").replace(/\D/g, "");

export function last10(phone) {
  const d = digitsOnly(phone);
  return d.length >= 10 ? d.slice(-10) : d;
}

export function samePhone(a, b) {
  const x = last10(a);
  const y = last10(b);
  return x.length === 10 && x === y;
}

export async function findCustomerByPhone(phone, { useNormalizedColumn = process.env.PHONE_NORMALIZED_COLUMN === "true" } = {}) {
  const key = last10(phone);
  if (key.length !== 10) return null;

  if (useNormalizedColumn) {
    return prisma.customer.findFirst({
      where: { ContactLast10: key },
      orderBy: { createdAt: "desc" },
    });
  }

  const direct = await prisma.customer.findFirst({
    where: { ContactNumber: { contains: key } },
    orderBy: { createdAt: "desc" },
  });
  if (direct) return direct;

  const candidates = await prisma.customer.findMany({
    where: { ContactNumber: { contains: key.slice(-4) } },
    select: { id: true, ContactNumber: true },
    take: 500,
  });
  const hit = candidates.find((c) => samePhone(c.ContactNumber, key));
  return hit ? prisma.customer.findUnique({ where: { id: hit.id } }) : null;
}