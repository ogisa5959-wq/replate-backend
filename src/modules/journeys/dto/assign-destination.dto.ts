import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID, IsOptional, IsString } from 'class-validator';

export class AssignDestinationDto {
  @ApiProperty({ example: '20000000-0000-0000-0000-000000000001', description: 'ID profil mitra penerima' })
  @IsUUID('4', { message: 'ID penerima harus berupa UUID valid' })
  @IsNotEmpty({ message: 'ID penerima wajib diisi' })
  recipientId!: string;

  @ApiPropertyOptional({ example: 'Diserahkan langsung ke penanggung jawab dapur', description: 'Catatan serah terima' })
  @IsOptional()
  @IsString()
  notes?: string;
}
