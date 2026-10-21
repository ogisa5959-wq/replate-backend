import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    example: 'purbalingga-karangreja atau admin@replate.id',
    description: 'Alamat email atau nama pengguna akun Purbalingga terdaftar',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'Email harus berupa string' })
  email?: string;

  @ApiProperty({
    example: 'purbalingga-karangreja',
    description: 'Identifier username opsional (dapat digunakan sebagai pengganti email)',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'Identifier harus berupa string' })
  identifier?: string;

  @ApiProperty({ example: 'password123', description: 'Kata sandi pengguna (default: password123)' })
  @IsString({ message: 'Password harus berupa string' })
  @IsNotEmpty({ message: 'Password wajib diisi' })
  @MinLength(6, { message: 'Password minimal 6 karakter' })
  password!: string;
}
