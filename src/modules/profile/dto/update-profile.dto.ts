import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RecipientType } from '@prisma/client';

export class RecipientProfileSpecsDto {
  @ApiPropertyOptional({ enum: RecipientType, example: RecipientType.COMMUNITY_KITCHEN })
  @IsOptional()
  @IsEnum(RecipientType, { message: 'Tipe penerima tidak valid' })
  recipientType?: RecipientType;

  @ApiPropertyOptional({ example: 100.0, description: 'Kapasitas daya tampung harian dalam kg' })
  @IsOptional()
  @IsNumber({}, { message: 'Kapasitas harus berupa angka' })
  @Min(1, { message: 'Kapasitas minimal 1 kg' })
  dailyMaxCapacityKg?: number;

  @ApiPropertyOptional({ example: true, description: 'Ketersediaan pendingin/kulkas' })
  @IsOptional()
  @IsBoolean({ message: 'hasRefrigeration harus berupa boolean' })
  hasRefrigeration?: boolean;

  @ApiPropertyOptional({ example: false, description: 'Ketersediaan freezer pembeku' })
  @IsOptional()
  @IsBoolean({ message: 'hasFreezer harus berupa boolean' })
  hasFreezer?: boolean;

  @ApiPropertyOptional({
    example: ['COOKED_MEALS', 'BAKERY_PASTRY'],
    description: 'Kategori makanan yang diterima',
  })
  @IsOptional()
  @IsArray({ message: 'acceptedFoodCategories harus berupa array' })
  acceptedFoodCategories?: string[];
}

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Siti Rahma', description: 'Nama lengkap pengguna' })
  @IsOptional()
  @IsString({ message: 'Nama lengkap harus berupa string' })
  @MinLength(2, { message: 'Nama lengkap minimal 2 karakter' })
  fullName?: string;

  @ApiPropertyOptional({ example: 'Dapur Barokah Matraman', description: 'Nama badan/organisasi/katering' })
  @IsOptional()
  @IsString({ message: 'Nama organisasi harus berupa string' })
  @MinLength(2, { message: 'Nama organisasi minimal 2 karakter' })
  organizationName?: string;

  @ApiPropertyOptional({ example: 'Jl. Matraman Raya No. 42, Jakarta Timur', description: 'Alamat fisik lengkap' })
  @IsOptional()
  @IsString({ message: 'Alamat harus berupa string' })
  @MinLength(5, { message: 'Alamat fisik minimal 5 karakter' })
  address?: string;

  @ApiPropertyOptional({ example: '0812-3456-7890', description: 'Nomor telepon narahubung' })
  @IsOptional()
  @IsString({ message: 'Nomor telepon harus berupa string' })
  contactPhone?: string;

  @ApiPropertyOptional({ example: 'kontak@organisasi.id', description: 'Email resmi narahubung organisasi' })
  @IsOptional()
  @IsEmail({}, { message: 'Format contactEmail tidak valid' })
  contactEmail?: string;

  @ApiPropertyOptional({ example: -6.2088, description: 'Koordinat lintang (Latitude antara -90 dan 90)' })
  @IsOptional()
  @IsNumber({}, { message: 'Latitude harus berupa angka desimal' })
  @Min(-90, { message: 'Latitude minimal -90' })
  @Max(90, { message: 'Latitude maksimal 90' })
  latitude?: number;

  @ApiPropertyOptional({ example: 106.8456, description: 'Koordinat bujur (Longitude antara -180 dan 180)' })
  @IsOptional()
  @IsNumber({}, { message: 'Longitude harus berupa angka desimal' })
  @Min(-180, { message: 'Longitude minimal -180' })
  @Max(180, { message: 'Longitude maksimal 180' })
  longitude?: number;

  @ApiPropertyOptional({ type: RecipientProfileSpecsDto, description: 'Spesifikasi operasional khusus Mitra' })
  @IsOptional()
  @ValidateNested()
  @Type(() => RecipientProfileSpecsDto)
  recipientProfile?: RecipientProfileSpecsDto;
}
