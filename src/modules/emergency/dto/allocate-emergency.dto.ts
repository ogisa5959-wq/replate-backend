import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class AllocateEmergencyDto {
  @ApiProperty({
    example: '7a3e5c9b-6b21-4f12-88d3-7d8b9e000101',
    description: 'ID Surplus Listing yang akan dialokasikan (wajib berstatus PASS pada Food Safety Gate)',
  })
  @IsUUID('4', { message: 'surplusListingId harus berupa UUID v4 yang valid' })
  @IsNotEmpty({ message: 'surplusListingId wajib diisi' })
  surplusListingId!: string;

  @ApiPropertyOptional({
    example: 'Dialokasikan untuk posko pengungsi banjir shift makan siang',
    description: 'Catatan serah terima alokasi',
  })
  @IsOptional()
  @IsString({ message: 'Catatan harus berupa string' })
  notes?: string;
}
