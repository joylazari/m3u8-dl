import * as Ffmpeg from 'fluent-ffmpeg';
import {Spinner} from 'clui';
import * as chalk from 'chalk';
import {Writable} from "stream";

export type FFMpegServiceResponse = { err: boolean; status: string }

export class FFMpegService {

    private readonly process: Ffmpeg.FfmpegCommand;
    private readonly spinner: Spinner;
    private loadingSpinner: string[] = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'];
    private timeout: number = 30 // Timeout in minutes

    constructor(input: string, output: string | Writable, inputOptions: string[], outputOptions: string[]) {
        this.spinner = new Spinner('', this.loadingSpinner)
        this.process = Ffmpeg(input)
        this.process.output(output)
        this.process.inputOptions(inputOptions)
        this.process.outputOptions(outputOptions)
    }

    execute(processingMessage: string = ''): Promise<FFMpegServiceResponse> {
        return new Promise((resolve, reject) => {
            this.process.on('start', (commandLine) => {
                this.spinner.start()
            })
            this.process.on('progress', (progress) => {
                let processingProgressMessage: string = processingMessage,
                    percent: number = Math.ceil(progress.percent);
                if (percent) {
                    processingProgressMessage = `${processingMessage}: ${percent}%`
                }
                this.spinner.message(`${processingProgressMessage}`)
            })
            this.process.on('error', (err) => {
                this.process.kill('SIGKILL')
                this.spinner.stop()
                reject({err: true, status: `An error occurred while ${processingMessage}: ${err.message}`})
            })
            this.process.on('end', () => {
                this.spinner.stop()
                resolve({err: false, status: `${processingMessage} succeeded!`})
            })
            this.process.run()

            // Kill ffmpeg after this.timeout minutes anyway
            setTimeout(() => {
                this.process.on('error', () => console.log(chalk.keyword('orange')('FFMpeg has been killed')))
                this.process.kill('SIGKILL')
                reject({err: true, status: `${this.timeout} minutes timeout reached!`})
                this.spinner.stop()
            }, this.timeout * 60 * 1000)
        });
    }
}
