import { Module } from '@nestjs/common';
import { CapacityService } from './capacity.service';
import { RecipientsController } from './recipients.controller';

@Module({
  imports: [],
  controllers: [RecipientsController],
  providers: [CapacityService],
  exports: [CapacityService],
})
export class RecipientsModule {}
