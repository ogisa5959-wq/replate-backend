import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min, MinLength, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import { UserRole } from '@prisma/client';

export class RegisterDto {
  @ApiProperty({ example: 'dapurberkah', description: 'Username pengguna (minimal 3 karakter)' })
  @IsString({ message: 'Username harus berupa string' })
  @IsNotEmpty({ message: 'Username wajib diisi' })
  @MinLength(3, { message: 'Username minimal 3 karakter' })
  username!: string;

  @ApiProperty({ example: 'kontak@dapurberkah.org', description: 'Alamat email pengguna' })
  @IsEmail({}, { message: 'Format email tidak valid' })
  @IsNotEmpty({ message: 'Email wajib diisi' })
  email!: string;

  @ApiProperty({ example: 'PasswordAman123!', description: 'Kata sandi pengguna (minimal 6 karakter)' })
  @IsString({ message: 'Password harus berupa string' })
  @IsNotEmpty({ message: 'Password wajib diisi' })
  @MinLength(6, { message: 'Password minimal 6 karakter' })
  password!: string;

  @ApiProperty({ example: 'Siti Rahma', description: 'Nama lengkap pengguna' })
  @IsString({ message: 'Nama harus berupa string' })
  @IsNotEmpty({ message: 'Nama lengkap wajib diisi' })
  name!: string;

  @ApiPropertyOptional({ example: 'Dapur Barokah Matraman', description: 'Alias nama organisasi' })
  @IsOptional()
  @IsString({ message: 'Nama organisasi harus berupa string' })
  organization?: string;

  @ApiPropertyOptional({ example: 'Dapur Barokah Matraman', description: 'Nama organisasi/perusahaan/dapur' })
  @ValidateIf((o) => !o.organization)
  @IsString({ message: 'Nama organisasi harus berupa string' })
  @IsNotEmpty({ message: 'Nama organisasi wajib diisi' })
  organizationName?: string;

  @ApiPropertyOptional({ example: 'Jl. Sudirman No. 10, Jakarta', description: 'Alamat fisik fasilitas/dapur' })
  @IsOptional()
  @IsString({ message: 'Alamat harus berupa string' })
  address?: string;

  @ApiPropertyOptional({ example: -6.2088, description: 'Titik lintang geospasial (-90 s/d 90)' })
  @IsOptional()
  @IsNumber({}, { message: 'Latitude harus berupa angka numerik' })
  @Min(-90, { message: 'Latitude tidak boleh kurang dari -90' })
  @Max(90, { message: 'Latitude tidak boleh lebih dari 90' })
  latitude?: number;

  @ApiPropertyOptional({ example: 106.8456, description: 'Titik bujur geospasial (-180 s/d 180)' })
  @IsOptional()
  @IsNumber({}, { message: 'Longitude harus berupa angka numerik' })
  @Min(-180, { message: 'Longitude tidak boleh kurang dari -180' })
  @Max(180, { message: 'Longitude tidak boleh lebih dari 180' })
  longitude?: number;

  @ApiProperty({ example: 'MITRA', enum: ['SUPPLIER', 'MITRA'], description: 'Peran pengguna (SUPPLIER atau MITRA)' })
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
  @IsEnum(UserRole, { message: 'Role harus SUPPLIER atau MITRA' })
  @IsNotEmpty({ message: 'Role wajib diisi' })
  role!: UserRole;
}
