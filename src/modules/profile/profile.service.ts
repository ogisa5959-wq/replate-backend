import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AuditAction, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';

@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Mengambil data profil lengkap pengguna terautentikasi,
   * mencakup informasi akun, organisasi, titik koordinat geospasial,
   * dan spesifikasi penerima (jika role MITRA).
   */
  async getProfile(userId: string) {
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
      throw new NotFoundException('Pengguna tidak ditemukan');
    }

    const { organization } = user;
    const { recipientProfile } = organization;

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      organization: {
        id: organization.id,
        name: organization.name,
        type: organization.type,
        address: organization.address,
        contactPhone: organization.contactPhone,
        contactEmail: organization.contactEmail,
        latitude: organization.latitude ? Number(organization.latitude) : null,
        longitude: organization.longitude ? Number(organization.longitude) : null,
        isVerified: organization.isVerified,
        createdAt: organization.createdAt,
        updatedAt: organization.updatedAt,
      },
      recipientProfile: recipientProfile
        ? {
            id: recipientProfile.id,
            recipientType: recipientProfile.recipientType,
            dailyMaxCapacityKg: Number(recipientProfile.dailyMaxCapacityKg),
            hasRefrigeration: recipientProfile.hasRefrigeration,
            hasFreezer: recipientProfile.hasFreezer,
            acceptedFoodCategories: recipientProfile.acceptedFoodCategories,
            latitude: Number(recipientProfile.latitude),
            longitude: Number(recipientProfile.longitude),
          }
        : null,
    };
  }

  /**
   * Memperbarui profil pengguna, data organisasi, titik koordinat geospasial,
   * serta kapasitas & fasilitas mitra (jika role MITRA).
   */
  async updateProfile(userId: string, dto: UpdateProfileDto) {
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
      throw new NotFoundException('Pengguna tidak ditemukan');
    }

    await this.prisma.$transaction(async (tx) => {
      // 1. Update data User jika ada perubahan fullName
      if (dto.fullName) {
        await tx.user.update({
          where: { id: userId },
          data: { fullName: dto.fullName.trim() },
        });
      }

      // 2. Siapkan data mutasi Organization
      const orgUpdateData: {
        name?: string;
        address?: string;
        contactPhone?: string | null;
        contactEmail?: string | null;
        latitude?: number | null;
        longitude?: number | null;
      } = {};

      if (dto.organizationName) {
        orgUpdateData.name = dto.organizationName.trim();
      }
      if (dto.address) {
        orgUpdateData.address = dto.address.trim();
      }
      if (dto.contactPhone !== undefined) {
        orgUpdateData.contactPhone = dto.contactPhone?.trim() || null;
      }
      if (dto.contactEmail !== undefined) {
        orgUpdateData.contactEmail = dto.contactEmail?.trim() || null;
      }
      if (dto.latitude !== undefined) {
        orgUpdateData.latitude = dto.latitude;
      }
      if (dto.longitude !== undefined) {
        orgUpdateData.longitude = dto.longitude;
      }

      if (Object.keys(orgUpdateData).length > 0) {
        await tx.organization.update({
          where: { id: user.organizationId },
          data: orgUpdateData,
        });
      }

      // 3. Jika pengguna adalah MITRA dan memiliki RecipientProfile
      if (
        user.role === UserRole.MITRA &&
        user.organization.recipientProfile
      ) {
        const recipientProfileId = user.organization.recipientProfile.id;
        const profileUpdateData: {
          latitude?: number;
          longitude?: number;
          recipientType?: any;
          dailyMaxCapacityKg?: number;
          hasRefrigeration?: boolean;
          hasFreezer?: boolean;
          acceptedFoodCategories?: any;
        } = {};

        // Sinkronisasi koordinat geospasial ke RecipientProfile
        if (dto.latitude !== undefined) {
          profileUpdateData.latitude = dto.latitude;
        }
        if (dto.longitude !== undefined) {
          profileUpdateData.longitude = dto.longitude;
        }

        // Pembaruan spesifikasi operasional penerima
        if (dto.recipientProfile) {
          const specs = dto.recipientProfile;
          if (specs.recipientType) {
            profileUpdateData.recipientType = specs.recipientType;
          }
          if (specs.dailyMaxCapacityKg !== undefined) {
            profileUpdateData.dailyMaxCapacityKg = specs.dailyMaxCapacityKg;
          }
          if (specs.hasRefrigeration !== undefined) {
            profileUpdateData.hasRefrigeration = specs.hasRefrigeration;
          }
          if (specs.hasFreezer !== undefined) {
            profileUpdateData.hasFreezer = specs.hasFreezer;
          }
          if (specs.acceptedFoodCategories !== undefined) {
            profileUpdateData.acceptedFoodCategories =
              specs.acceptedFoodCategories;
          }
        }

        if (Object.keys(profileUpdateData).length > 0) {
          await tx.recipientProfile.update({
            where: { id: recipientProfileId },
            data: profileUpdateData,
          });

          // Jika kapasitas harian diubah, perbarui kuota kapasitas aktif hari ini
          if (dto.recipientProfile?.dailyMaxCapacityKg !== undefined) {
            const newMax = dto.recipientProfile.dailyMaxCapacityKg;
            const today = new Date();
            today.setUTCHours(0, 0, 0, 0);

            const todayCapacity = await tx.recipientCapacity.findUnique({
              where: {
                recipientId_capacityDate: {
                  recipientId: recipientProfileId,
                  capacityDate: today,
                },
              },
            });

            if (todayCapacity) {
              const allocated = Number(todayCapacity.allocatedCapacityKg);
              const received = Number(todayCapacity.receivedCapacityKg);
              const available = Math.max(0, newMax - (allocated + received));

              await tx.recipientCapacity.update({
                where: { id: todayCapacity.id },
                data: {
                  maxCapacityKg: newMax,
                  availableCapacityKg: available,
                },
              });
            }
          }
        }
      }

      // 4. Catat Audit Log
      await tx.auditLog.create({
        data: {
          tableName: 'users',
          recordId: user.id,
          action: AuditAction.UPDATE,
          actorUserId: user.id,
          previousState: {
            fullName: user.fullName,
            organizationName: user.organization.name,
            address: user.organization.address,
            latitude: user.organization.latitude
              ? Number(user.organization.latitude)
              : null,
            longitude: user.organization.longitude
              ? Number(user.organization.longitude)
              : null,
          },
          newState: {
            fullName: dto.fullName || user.fullName,
            organizationName: dto.organizationName || user.organization.name,
            address: dto.address || user.organization.address,
            latitude:
              dto.latitude !== undefined
                ? dto.latitude
                : user.organization.latitude
                ? Number(user.organization.latitude)
                : null,
            longitude:
              dto.longitude !== undefined
                ? dto.longitude
                : user.organization.longitude
                ? Number(user.organization.longitude)
                : null,
          },
          reason: 'Pembaruan profil akun, alamat, dan koordinat geospasial',
        },
      });
    });

    // Kembalikan profil yang telah diperbarui setelah transaksi komit
    return this.getProfile(userId);
  }

  /**
   * Mengubah kata sandi pengguna dengan verifikasi kata sandi lama,
   * enkripsi Argon2id kata sandi baru, serta pencabutan (revocation) refresh token aktif.
   */
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('Pengguna tidak ditemukan');
    }

    // 1. Verifikasi kata sandi saat ini
    const isCurrentValid = await argon2.verify(
      user.passwordHash,
      dto.currentPassword,
    );
    if (!isCurrentValid) {
      throw new UnauthorizedException('Kata sandi saat ini tidak sesuai');
    }

    // 2. Validasi kata sandi baru tidak boleh sama dengan kata sandi lama
    const isSamePassword = await argon2.verify(
      user.passwordHash,
      dto.newPassword,
    );
    if (isSamePassword) {
      throw new BadRequestException(
        'Kata sandi baru tidak boleh sama dengan kata sandi saat ini',
      );
    }

    // 3. Hash kata sandi baru menggunakan Argon2id
    const newPasswordHash = await argon2.hash(dto.newPassword);

    // 4. Update kata sandi dan cabut semua refresh token aktif di dalam transaksi
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash: newPasswordHash },
      });

      // Cabut seluruh refresh token aktif untuk memastikan sesi lama diputus
      await tx.refreshToken.updateMany({
        where: { userId, isRevoked: false },
        data: { isRevoked: true },
      });

      // Catat Audit Log tanpa mencatat kata sandi mentah/hash
      await tx.auditLog.create({
        data: {
          tableName: 'users',
          recordId: user.id,
          action: AuditAction.UPDATE,
          actorUserId: user.id,
          reason: 'Perubahan kata sandi akun dan pencabutan sesi aktif',
        },
      });
    });

    return {
      success: true,
      message: 'Kata sandi berhasil diperbarui. Silakan gunakan kata sandi baru untuk sesi berikutnya.',
    };
  }
}
