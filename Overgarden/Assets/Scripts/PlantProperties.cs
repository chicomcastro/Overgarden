using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class PlantProperties : MonoBehaviour
{
    // personalizar os arrays dependendo da espécie!
    int[] time; 
    int[] value;
   public int difficultyToGrow(int a) // usada no StageScript. O valor retornado é usado pra
   {                                  // determinar de quantos em quantos frames a StageBar
       return time[a - 1];            // cresce! (quanto maior o valor, mais demora, por essa lógica).
   }

   public int plantValue(int a) // não foi usada ainda!!
   {
       return value[a - 1];
   }
}
