import { Module } from '@nestjs/common';
import { EmergencyController } from './emergency.controller';
import { EmergencyService } from './emergency.service';
import { BroadcastController } from './broadcast.controller';
import { BroadcastService } from './broadcast.service';
import { RecipientsModule } from '../recipients/recipients.module';

@Module({
  imports: [RecipientsModule],
  controllers: [EmergencyController, BroadcastController],
  providers: [EmergencyService, BroadcastService],
  exports: [EmergencyService, BroadcastService],
})
export class EmergencyModule {}
