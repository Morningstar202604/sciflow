import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { users, type User } from '../db/schema';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AuthPayload {
  sub: string;
  email: string;
  role: string;
}

export function publicUser(u: User) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.createdAt };
}

/** 企业认证服务：注册 / 登录 / 签发与校验 JWT（bcryptjs 哈希，无原生编译依赖） */
@Injectable()
export class AuthService {
  constructor(private readonly jwt: JwtService) {}

  private sign(u: User): string {
    const payload: AuthPayload = { sub: u.id, email: u.email, role: u.role || 'member' };
    return this.jwt.sign(payload);
  }

  async register(email: string, password: string, name?: string) {
    const mail = String(email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(mail)) throw new BadRequestException('邮箱格式不正确');
    if (typeof password !== 'string' || password.length < 8) {
      throw new BadRequestException('密码至少 8 位');
    }
    const existing = (await db.select().from(users).where(eq(users.email, mail)).limit(1))[0];
    if (existing) throw new BadRequestException('该邮箱已注册，请直接登录');

    const count = (await db.select({ id: users.id }).from(users)).length;
    const role = count === 0 ? 'admin' : 'member'; // 首位用户自动成为管理员
    const row: typeof users.$inferInsert = {
      id: randomUUID(),
      email: mail,
      passwordHash: await bcrypt.hash(password, 10),
      name: String(name || mail.split('@')[0]).slice(0, 60),
      role,
      createdAt: Date.now(),
    };
    const [created] = await db.insert(users).values(row).returning();
    return { token: this.sign(created), user: publicUser(created) };
  }

  async login(email: string, password: string) {
    const mail = String(email || '').trim().toLowerCase();
    const u = (await db.select().from(users).where(eq(users.email, mail)).limit(1))[0];
    if (!u) throw new UnauthorizedException('邮箱或密码不正确');
    const ok = await bcrypt.compare(String(password || ''), u.passwordHash);
    if (!ok) throw new UnauthorizedException('邮箱或密码不正确');
    return { token: this.sign(u), user: publicUser(u) };
  }

  async me(payload: AuthPayload) {
    const u = (await db.select().from(users).where(eq(users.id, payload.sub)).limit(1))[0];
    if (!u) throw new UnauthorizedException('用户不存在或已被移除');
    return publicUser(u);
  }
}
