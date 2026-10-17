import { createOrderDetector } from './orderOcrPipeline.js';
import { recognizeOcrData } from './ocrRecognize.js';
const detect=createOrderDetector(recognizeOcrData);
self.onmessage=async({data})=>{
  const {id,file,options}=data;
  try {self.postMessage({id,result:await detect(file,options)});}
  catch(error){self.postMessage({id,error:error.message,code:error.code});}
};
