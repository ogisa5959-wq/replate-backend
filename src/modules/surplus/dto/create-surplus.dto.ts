import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  IsISO8601,
} from 'class-validator';
import { FoodCategory, FoodCondition, PackagingStatus } from '@prisma/client';

export class CreateSurplusDto {
  @ApiProperty({ example: 'Nasi Kotak Ayam Bakar & Sayur', description: 'Nama makanan surplus' })
  @IsString()
  @IsNotEmpty()
  foodName!: string;

  @ApiProperty({ enum: FoodCategory, example: FoodCategory.COOKED_MEALS })
  @IsEnum(FoodCategory)
  foodCategory!: FoodCategory;

  @ApiPropertyOptional({ example: 'COOKED_BUFFET', description: 'Kode tipe pangan master' })
  @IsOptional()
  @IsString()
  foodTypeCode?: string;

  @ApiProperty({ example: 15.5, description: 'Berat total surplus dalam kilogram' })
  @IsNumber()
  @Min(0.1)
  quantityKg!: number;

  @ApiProperty({ example: 40, description: 'Estimasi jumlah porsi' })
  @IsNumber()
  @Min(1)
  portions!: number;

  @ApiProperty({ enum: FoodCondition, example: FoodCondition.FRESH })
  @IsEnum(FoodCondition)
  condition!: FoodCondition;

  @ApiPropertyOptional({ example: 65.0, description: 'Suhu penyimpanan aktual dalam Celcius' })
  @IsOptional()
  @IsNumber()
  storageTemperatureC?: number;

  @ApiProperty({ enum: PackagingStatus, example: PackagingStatus.INTACT_SEALED })
  @IsEnum(PackagingStatus)
  packagingStatus!: PackagingStatus;

  @ApiProperty({ example: 90, description: 'Skor higienitas (0 - 100)' })
  @IsNumber()
  @Min(0)
  hygieneScore!: number;

  @ApiProperty({ example: '2026-10-15T18:00:00.000Z', description: 'Waktu penyiapan makanan (ISO 8601)' })
  @IsISO8601()
  preparedAt!: string;

  @ApiPropertyOptional({ example: '1_3h', description: 'Label jendela waktu simpan aman' })
  @IsOptional()
  @IsString()
  timeWindowId?: string;

  @ApiPropertyOptional({ example: 'Sisa prasmanan seminar, baru diangkat dari pemanas', description: 'Catatan tambahan' })
  @IsOptional()
  @IsString()
  notes?: string;

  // Food Safety Gate Specific Parameters
  @ApiPropertyOptional({ example: 'no_visible_damage' })
  @IsOptional()
  @IsString()
  safetyConditionId?: string;

  @ApiPropertyOptional({ example: 'known_compliant' })
  @IsOptional()
  @IsString()
  storageHistoryId?: string;

  @ApiPropertyOptional({ example: 'hot_holding_above_60' })
  @IsOptional()
  @IsString()
  storageTempId?: string;

  @ApiPropertyOptional({ example: 'intact_proper' })
  @IsOptional()
  @IsString()
  packagingConditionId?: string;

  @ApiPropertyOptional({ example: 'hygienic_separated' })
  @IsOptional()
  @IsString()
  handlingIntegrityId?: string;

  @ApiPropertyOptional({ example: null })
  @IsOptional()
  @IsString()
  expiryDate?: string;
}
