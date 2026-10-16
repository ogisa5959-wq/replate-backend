import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class CancelJourneyDto {
  @ApiProperty({
    example: 'Penolakan fisik di lokasi mitra: makanan tercium bau asam menyengat dan kemasan penyok parah',
    description: 'Alasan pembatalan atau penolakan fisik di lokasi mitra (wajib diisi)',
  })
  @IsString({ message: 'Alasan pembatalan harus berupa teks' })
  @IsNotEmpty({ message: 'Alasan pembatalan wajib diisi untuk catatan audit trail' })
  @MinLength(5, { message: 'Alasan pembatalan minimal 5 karakter' })
  cancellationReason!: string;
}
