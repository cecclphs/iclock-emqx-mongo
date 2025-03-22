import { Hono } from 'hono';
import { MongoClient } from 'mongodb';

const mongo_uri = process.env.MONGO_URI!;

const client = new MongoClient(mongo_uri);
const database = client.db('iotdata');
const devices = database.collection('devices');

type EMQXMessage = {
  username: string,
  topic: string,
  timestamp: number,
  qos: number,
  publish_received_at: number,
  pub_props: object,
  peerhost: string,
  payload: string,
  node: string,
  metadata: object,
  id: string,
  flags: object,
  event: string,
  clientid: string
}
const app = new Hono()
  .post('/emqx/ingest',
    async (c) => {

      const emqx_message = await c.req.json() as EMQXMessage;
      const topic_split = emqx_message.topic.split('/');
      const device_id = emqx_message.clientid;
      const stat = topic_split[topic_split.length - 1];
      const filter = {
        device_id: device_id,
      }
      const update = {
        $set: {
          last_seen: new Date(),
          [`stats.${stat}`]: emqx_message.payload
        }
      }
      const result = await devices.updateOne(filter, update);
      // add to history collection
      const history = database.collection('temp_history');
      const history_entry = {
        device_id: device_id,
        stat: stat,
        timestamp: new Date(),
        value: emqx_message.payload
      }
      const result2 = await history.insertOne(history_entry);

      console.log(`Received message from ${device_id} with stat ${stat} and value ${emqx_message.payload}`);
      return c.text('OK');
    })
  .post('/emqx/firmware',
    async (c) => {
      const emqx_message = await c.req.json() as EMQXMessage;
      const device_id = emqx_message.clientid;
      const firmware_version = emqx_message.payload;
      const filter = {
        device_id: device_id,
      }
      const update = {
        $set: {
          last_seen: new Date(),
          fw_version: firmware_version
        }
      }
      const result = await devices.updateOne(filter, update);
      console.log(`Received firmware version from ${device_id}: ${firmware_version}`);
      return c.text('OK');
    })

export default app;