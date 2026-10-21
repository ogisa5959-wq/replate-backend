import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MinLength,
} from 'class-validator';
import { EmergencyUrgencyLevel } from '@prisma/client';

export class CreateEmergencyRequestDto {
  @ApiProperty({ example: 'cooked_meals', description: 'Kode kategori jenis pangan yang dibutuhkan' })
  @IsString({ message: 'Kategori makanan harus berupa string' })
  @IsNotEmpty({ message: 'Kategori makanan wajib diisi' })
  neededFoodType!: string;

  @ApiProperty({ example: 'Makanan Siap Santap / Nasi Kotak', description: 'Label tampilan jenis pangan' })
  @IsString({ message: 'Nama jenis makanan harus berupa string' })
  @IsNotEmpty({ message: 'Nama jenis makanan wajib diisi' })
  foodTypeName!: string;

  @ApiProperty({ example: 50, description: 'Jumlah porsi makanan yang dibutuhkan (> 0)' })
  @IsInt({ message: 'Jumlah porsi harus berupa bilangan bulat' })
  @IsPositive({ message: 'Jumlah porsi harus lebih dari 0' })
  requestedPortions!: number;

  @ApiProperty({ example: 50, description: 'Jumlah orang/penerima manfaat yang membutuhkan (> 0)' })
  @IsInt({ message: 'Jumlah penerima manfaat harus berupa bilangan bulat' })
  @IsPositive({ message: 'Jumlah penerima manfaat harus lebih dari 0' })
  beneficiaryCount!: number;

  @ApiProperty({ example: 'Warga Terdampak Banjir & Pengungsi', description: 'Kelompok sasaran penerima manfaat' })
  @IsString({ message: 'Kelompok penerima manfaat harus berupa string' })
  @IsNotEmpty({ message: 'Kelompok penerima manfaat wajib diisi' })
  beneficiaryGroup!: string;

  @ApiProperty({ example: 'Posko Dapur Umum Mandiri, Tebet Barat, Jakarta Selatan', description: 'Alamat tujuan pengantaran darurat' })
  @IsString({ message: 'Lokasi tujuan harus berupa string' })
  @IsNotEmpty({ message: 'Lokasi tujuan pengantaran wajib diisi' })
  targetLocation!: string;

  @ApiProperty({ example: 'CRITICAL', enum: EmergencyUrgencyLevel, description: 'Tingkat kedaruratan (CRITICAL, HIGH, MEDIUM)' })
  @IsEnum(EmergencyUrgencyLevel, { message: 'Tingkat urgensi harus CRITICAL, HIGH, atau MEDIUM' })
  @IsNotEmpty({ message: 'Tingkat urgensi wajib diisi' })
  urgencyLevel!: EmergencyUrgencyLevel;

  @ApiProperty({ example: 'Hari ini sebelum 12:30 WIB (Makan Siang)', description: 'Target batas waktu pemenuhan darurat' })
  @IsString({ message: 'Batas waktu harus berupa string' })
  @IsNotEmpty({ message: 'Target batas waktu wajib diisi' })
  urgencyDeadline!: string;

  @ApiProperty({ example: 'Lonjakan pengungsi baru sebanyak 50 jiwa pasca banjir bandang, stok dapur habis.', description: 'Alasan rinci kedaruratan (minimal 10 karakter)' })
  @IsString({ message: 'Alasan urgensi harus berupa string' })
  @IsNotEmpty({ message: 'Alasan urgensi wajib diisi' })
  @MinLength(10, { message: 'Alasan urgensi minimal 10 karakter' })
  urgencyReason!: string;

  @ApiProperty({ example: 'Ibu Siti Rahma (Koordinator)', description: 'Nama penanggung jawab / narahubung' })
  @IsString({ message: 'Narahubung harus berupa string' })
  @IsNotEmpty({ message: 'Nama narahubung wajib diisi' })
  contactPerson!: string;

  @ApiProperty({ example: '0812-3456-7890', description: 'Nomor telepon aktif koordinator' })
  @IsString({ message: 'Nomor telepon harus berupa string' })
  @IsNotEmpty({ message: 'Nomor telepon wajib diisi' })
  contactPhone!: string;

  @ApiPropertyOptional({ example: 'Diutamakan makanan siap santap higienis hangat dalam kemasan tertutup', description: 'Catatan tambahan penanganan' })
  @IsOptional()
  @IsString({ message: 'Catatan harus berupa string' })
  notes?: string;
}
