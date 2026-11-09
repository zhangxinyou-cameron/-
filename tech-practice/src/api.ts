declare global { interface Window { practice: { call(method: string, payload?: any): Promise<any>; startupReady(): void; startupFailed(message:string): void }; MonacoEnvironment: any; } }
export const api = <T = any>(method: string, payload: any = {}): Promise<T> => window.practice.call(method, payload);
export const typeNames: Record<string,string> = { single_choice:'单选',multiple_choice:'多选',true_false:'判断',code:'编程',rtl:'RTL',fill_blank:'填空 · 预留',short_answer:'简答 · 预留' };
export const domainNames: Record<string,string> = {digital_ic:'数字 IC', programming:'软件编程',computer_architecture:'计算机体系结构',embedded:'嵌入式'};
export const statusNames: Record<string,string> = {AC:'通过',WA:'答案不符',CE:'编译错误',RE:'运行错误',TLE:'超时',MLE:'内存超限',OLE:'输出超限',ENV_ERROR:'环境未就绪',JUDGE_ERROR:'评测异常',CANCELED:'已停止'};
export const dateTime = (value: string) => new Date(value).toLocaleString('zh-CN',{hour12:false});
export const questionIdentity = (q: any) => q.bankId + '/' + q.id;
