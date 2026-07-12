import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { COOKIE_NAME, makeSessionToken, readSessionToken } from "@/lib/session";
import { rateLimit, clientIp } from "@/lib/ratelimit";

// GET — return the current logged-in user
export async function GET(req: NextRequest) {
  const userId = readSessionToken(req.cookies.get(COOKIE_NAME)?.value);
  if (!userId) return NextResponse.json({ user: null });
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, createdAt: true },
  });
  return NextResponse.json({ user });
}

function setSession(res: NextResponse, userId: string) {
  res.cookies.set(COOKIE_NAME, makeSessionToken(userId), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365, path: "/",
  });
}

// POST — login or create an account (with password)
export async function POST(req: NextRequest) {
  // Anti brute-force: max 12 login/signup attempts per IP per 5 minutes.
  if (!rateLimit(`auth:${clientIp(req)}`, 12, 5 * 60 * 1000)) {
    return NextResponse.json({ error: "Trop de tentatives. Réessayez dans quelques minutes." }, { status: 429 });
  }
  const body = await req.json();
  const mode: "login" | "signup" = body.mode === "signup" ? "signup" : "login";
  const clean = (body.username ?? "").trim();
  const password = String(body.password ?? "");

  if (clean.length < 2 || clean.length > 24) {
    return NextResponse.json({ error: "Le pseudo doit faire entre 2 et 24 caractères." }, { status: 400 });
  }
  if (!/^[a-zA-Z0-9_\- ]+$/.test(clean)) {
    return NextResponse.json({ error: "Pseudo invalide (lettres, chiffres, - et _ uniquement)." }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "Le mot de passe doit faire au moins 6 caractères." }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { username: clean } });

  if (mode === "signup") {
    if (existing) {
      return NextResponse.json({ error: "Ce pseudo est déjà pris. Choisissez-en un autre ou connectez-vous." }, { status: 409 });
    }
    const hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({ data: { username: clean, passwordHash: hash } });
    const res = NextResponse.json({ user: { id: user.id, username: user.username, createdAt: user.createdAt } });
    setSession(res, user.id);
    return res;
  }

  // login
  if (!existing) {
    return NextResponse.json({ error: "Aucun compte à ce pseudo. Créez un compte." }, { status: 404 });
  }
  if (!existing.passwordHash) {
    // Legacy account (created before passwords) — set the password on first login.
    const hash = await bcrypt.hash(password, 10);
    await prisma.user.update({ where: { id: existing.id }, data: { passwordHash: hash } });
  } else {
    const ok = await bcrypt.compare(password, existing.passwordHash);
    if (!ok) return NextResponse.json({ error: "Mot de passe incorrect." }, { status: 401 });
  }
  const res = NextResponse.json({ user: { id: existing.id, username: existing.username, createdAt: existing.createdAt } });
  setSession(res, existing.id);
  return res;
}

// DELETE — logout
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(COOKIE_NAME);
  return res;
}
