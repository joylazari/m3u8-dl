import {Command, flags} from '@oclif/command'
import {createHash, Hash} from 'crypto'
import {readdirSync, writeFileSync} from 'fs';
import {Choice} from 'prompts';
import {FFMpegService, FFMpegServiceResponse} from './ffmpeg/FFMpegService';
import * as chalk from "chalk";
import {homedir} from 'os';
import {config as shellConfig, exec, mkdir, rm, ShellReturnValue} from 'shelljs';
import {notify} from 'node-notifier'
import prompts = require('prompts');

shellConfig.silent = true

class M3U8Downloader extends Command {
  static description = 'Download all the HLS/.ts chunks from the provided M3U8 playlist file and merge them into an MP4 file'

  static flags = {
    ...Command.flags,
    version: flags.version({char: 'v'}),
    help: flags.help({char: 'h'}),
  }

  static args = [{name: 'playlist', description: 'M3U8 playlist file or remote URI'}]

  async init(): Promise<void> {
    this.info('M3U8 Downloader')
  }

  async run() {
    const {args} = this.parse(M3U8Downloader)

    let M3U8File: string
    if (args.playlist) {
      M3U8File = args.playlist
    } else {
      let playlistResponse = await this.obtainM3U8File()
      M3U8File = playlistResponse.M3U8File
    }
    const fileNameResponse: prompts.Answers<any> = await this.defineFileName(M3U8File),
        fileName: string = fileNameResponse.fileName,
        outputDirResponse: prompts.Answers<any> = await this.obtainOutputDir(fileName),
        outputDir: string = exec(`printf ${outputDirResponse.outputDir}/${fileName}`).stdout;
    if (mkdir('-p', outputDir).stderr) this.exit(0)
    this.info(`File will be saved in: ${outputDir}`)

    const versions: prompts.Choice[] = await this.obtainVideoVersions(M3U8File),
        versionResponse: prompts.Answers<any> = await this.obtainVersion(versions),
        version: string = `p:${versionResponse.version}`, chunksDir: string = `${outputDir}/chunks`;
    await mkdir('-p', chunksDir)

    const downloaded: FFMpegServiceResponse = await this.download(M3U8File, version, outputDir)
    if (downloaded.err) {
      this.error(downloaded.status)
      this.exit(1)
    }
    this.info(downloaded.status)

    const merged: FFMpegServiceResponse = await this.mergeChunks(chunksDir, `${outputDir}/${fileName}.mp4`)
    if (merged.err) {
      this.error(merged.status)
      this.exit(1)
    }
    this.info(merged.status)

    rm('-rf', `${outputDir}/chunks`)
    rm(`${outputDir}/out.list`)
    this.success('Job done!')
    notify({
      title: 'M3U8-DL',
      message: 'M3U8 Playlist donloaded!'
    })
    this.exit(1)
  }

  protected async mergeChunks(chunksDir: string, outputFile: string): Promise<FFMpegServiceResponse> {
    let allts: string = ""
    readdirSync(chunksDir).forEach(file => {
      allts += `file ${chunksDir}/${file}\n`
    })
    writeFileSync(`${chunksDir}/all.ts`, allts);
    return new FFMpegService(
        `${chunksDir}/all.ts`,
        outputFile,
        ['-f concat', '-safe 0'],
        ['-c copy', '-vcodec h264']
    ).execute('Merging')
  }

  protected obtainM3U8File(): Promise<prompts.Answers<string>> {
    return prompts({
      type: 'text',
      name: 'M3U8File',
      message: 'M3U8 file',
      validate: uri => /^.+?\.m3u8$/.test(uri) || 'Not a valid M3U8 file'
    });
  }

  protected async download(M3U8File: string, version: string, outputDir: string): Promise<FFMpegServiceResponse> {
    return new FFMpegService(
        M3U8File,
        `${outputDir}/chunks/%04d.ts`,
        [],
        ['-map ' + version, '-c copy', '-f segment', `-segment_list ${outputDir}/out.list`]
    ).execute('Downloading')
  }

  protected defineFileName(M3U8File: string): Promise<prompts.Answers<string>> {
    const shasum: Hash = createHash('sha1')
    shasum.update(M3U8File)
    const shaFilename: string = shasum.digest('hex')
    return prompts({
      type: 'text',
      name: 'fileName',
      message: 'File name',
      initial: shaFilename,
    })
  }

  protected obtainOutputDir(fileName: string): Promise<prompts.Answers<string>> {
    return prompts({
      type: 'text',
      name: 'outputDir',
      message: 'Save to',
      initial: `${homedir()}/${fileName}`,
    })
  }

  protected obtainVideoVersions(M3U8: string): prompts.Choice[] {
    let output: string & ShellReturnValue = exec('ffmpeg -i ' + M3U8),
        regex: RegExp = /Stream.+?Video.*/g,
        matches: RegExpExecArray | null,
        versions: string[] = [],
        choices: Choice[] = []
    while ((matches = regex.exec(output.stderr)) !== null) {
      if (matches.index === regex.lastIndex) regex.lastIndex++
      matches.forEach((match) => {
        versions.push(match)
      })
    }
    for (let i in versions) {
      let version: string = versions[i],
          quality: RegExpExecArray | null = /(\d{2,4}x\d{2,4})/.exec(version),
          title: string = quality ? quality[1] : version,
          description: string = quality ? version : ''
      choices.push({title, description, value: parseInt(i)})
    }
    return choices
  }

  protected obtainVersion(versions: prompts.Choice[]): Promise<prompts.Answers<string>> {
    return prompts({
      type: 'select',
      name: 'version',
      message: 'Select version',
      choices: versions,
    })
  }

  private info(message?: string, ...args: any[]): void {
    this.log(chalk.bold.cyan(message), ...args)
  }

  private success(message?: string, ...args: any[]): void {
    this.log(chalk.bold.green(message), ...args)
  }

  async catch(error: any): Promise<void> {
    this.error(error)
    throw error;
  }
}

export = M3U8Downloader
