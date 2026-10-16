import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, Min, IsOptional, IsString } from 'class-validator';

export class ConfirmReceiptDto {
  @ApiProperty({ example: 14.5, description: 'Berat aktual makanan yang diterima secara fisik di lokasi (kg)' })
  @IsNumber()
  @Min(0.1, { message: 'Berat aktual fisik minimal 0.1 kg' })
  @IsNotEmpty({ message: 'Berat aktual fisik wajib diisi saat serah terima' })
  actualReceivedKg!: number;

  @ApiPropertyOptional({ example: 'Kondisi hangat, kemasan utuh, langsung masuk persiapan distribusi santap malam', description: 'Catatan penerimaan' })
  @IsOptional()
  @IsString()
  notes?: string;
}
