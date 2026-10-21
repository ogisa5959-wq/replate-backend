import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class CancelJourneyDto {
  @ApiProperty({
    example: 'Penolakan fisik di lokasi mitra: makanan tercium bau asam menyengat dan kemasan penyok parah',
    description: 'Alasan pembatalan atau penolakan fisik di lokasi mitra (wajib diisi)',
  })
  @IsString({ message: 'Alasan pembatalan harus berupa teks' })
  @IsNotEmpty({ message: 'Alasan pembatalan wajib diisi untuk catatan audit trail' })
  @MinLength(5, { message: 'Alasan pembatalan minimal 5 karakter' })
  cancellationReason!: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Penanda bahwa pembatalan disebabkan oleh insiden kendala armada/kemasan di perjalanan (in-transit)',
  })
  @IsOptional()
  @IsBoolean()
  isIncidentReport?: boolean;

  @ApiPropertyOptional({
    example: 'Budi Santoso (Kurir)',
    description: 'Identitas pihak atau koordinator yang melaporkan kendala logistik',
  })
  @IsOptional()
  @IsString()
  issueReportedBy?: string;

  @ApiPropertyOptional({
    example: 'Kendaraan mogok di tol lingkar luar, pendingin mati lebih dari 3 jam',
    description: 'Catatan tambahan terkait penolakan fisik atau insiden',
  })
  @IsOptional()
  @IsString()
  note?: string;
}

