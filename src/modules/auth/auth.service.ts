import { Injectable, UnauthorizedException, BadRequestException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  async login(loginDto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: loginDto.email },
      include: { organization: true },
    });

    if (!user) {
      throw new UnauthorizedException('Email atau password tidak sesuai');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Akun pengguna telah dinonaktifkan');
    }

    const isPasswordValid = await argon2.verify(user.passwordHash, loginDto.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Email atau password tidak sesuai');
    }

    const tokens = await this.generateTokens(user.id, user.email, user.role, user.organizationId);

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        organization: {
          id: user.organization.id,
          name: user.organization.name,
          type: user.organization.type,
        },
      },
      ...tokens,
    };
  }

  async generateTokens(userId: string, email: string, role: string, organizationId: string) {
    const accessSecret = this.configService.get<string>('jwt.accessSecret') || 'dev-insecure-access-secret-replace-in-production-min-32-chars';
    const accessExpiresIn = this.configService.get<string>('jwt.accessExpiresIn') || '15m';

    const payload = {
      sub: userId,
      email,
      role,
      organizationId,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: accessSecret,
      expiresIn: accessExpiresIn,
    });

    // Create random refresh token string
    const rawRefreshToken = crypto.randomBytes(40).toString('hex');
    const tokenHash = this.hashToken(rawRefreshToken);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
        isRevoked: false,
      },
    });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      expiresIn: 900, // 15 minutes in seconds
    };
  }

  async refreshTokens(rawRefreshToken: string) {
    if (!rawRefreshToken) {
      throw new BadRequestException('Refresh token wajib disertakan');
    }

    const tokenHash = this.hashToken(rawRefreshToken);
    const existingToken = await this.prisma.refreshToken.findFirst({
      where: {
        tokenHash,
        isRevoked: false,
        expiresAt: { gt: new Date() },
      },
      include: {
        user: {
          include: { organization: true },
        },
      },
    });

    if (!existingToken || !existingToken.user.isActive) {
      throw new UnauthorizedException('Refresh token tidak valid atau telah kedaluwarsa');
    }

    // Revoke old refresh token (Token Rotation)
    await this.prisma.refreshToken.update({
      where: { id: existingToken.id },
      data: { isRevoked: true },
    });

    // Generate new pair
    const tokens = await this.generateTokens(
      existingToken.user.id,
      existingToken.user.email,
      existingToken.user.role,
      existingToken.user.organizationId,
    );

    return {
      user: {
        id: existingToken.user.id,
        email: existingToken.user.email,
        fullName: existingToken.user.fullName,
        role: existingToken.user.role,
        organization: {
          id: existingToken.user.organization.id,
          name: existingToken.user.organization.name,
          type: existingToken.user.organization.type,
        },
      },
      ...tokens,
    };
  }

  async logout(userId: string, rawRefreshToken?: string) {
    if (rawRefreshToken) {
      const tokenHash = this.hashToken(rawRefreshToken);
      await this.prisma.refreshToken.updateMany({
        where: { userId, tokenHash },
        data: { isRevoked: true },
      });
    } else {
      // Revoke all tokens for this user
      await this.prisma.refreshToken.updateMany({
        where: { userId, isRevoked: false },
        data: { isRevoked: true },
      });
    }

    return { message: 'Sesi berhasil diakhiri' };
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        organization: {
          include: {
            recipientProfile: true,
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Pengguna tidak ditemukan');
    }

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      organization: {
        id: user.organization.id,
        name: user.organization.name,
        type: user.organization.type,
        address: user.organization.address,
        isVerified: user.organization.isVerified,
        recipientProfile: user.organization.recipientProfile,
      },
    };
  }
}
